"""Instrumented LiteLlm adapter for conversation latency instrumentation.

Wraps ``google.adk.models.lite_llm.LiteLlm`` to stamp the first model-call
boundaries (``llm.request_start`` / ``llm.first_delta``) on the request-scoped
:class:`~src.smart_rag.infrastructure.monitoring.conversation_latency.ConversationLatencyTrace`,
and to emit the one-per-turn ``conversation_latency_diag.runner_pre_model``
structured summary at first provider entry.

Hot-path cost is a ContextVar lookup plus scalar assignments and (once per
turn) one structured log of safe scalars — no request serialization beyond
cheap content/part/tool counts. When no trace is installed the wrapper is
behaviorally transparent.
"""

from __future__ import annotations

from typing import AsyncGenerator, Optional, Tuple
from contextlib import aclosing
from functools import cached_property
from types import SimpleNamespace
from typing import Literal

from google.adk.models.lite_llm import LiteLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.models.llm_request import LlmRequest
from google.adk.integrations.openai import OpenAIResponsesLlm

from src.smart_rag.infrastructure.monitoring.conversation_latency import (
    get_current_conversation_latency_trace,
)
from src.smart_rag.infrastructure.monitoring.latency_diagnostics import (
    emit_runner_pre_model_log,
)


def _cheap_llm_counts(llm_request: LlmRequest) -> Tuple[int, int, int, bool]:
    """Structural counts only — never sizes derived from serialization."""
    contents = getattr(llm_request, "contents", None) or []
    content_count = len(contents)
    part_count = sum(len(getattr(content, "parts", None) or []) for content in contents)
    tools = getattr(llm_request, "tools_dict", None)
    tool_count = len(tools) if tools else 0
    system_present = bool(getattr(llm_request, "system_instruction", None))
    return content_count, part_count, tool_count, system_present


class InstrumentedLiteLlm(LiteLlm):
    """LiteLlm with first-call TTFT instrumentation; otherwise transparent."""

    def __init__(self, model: str, **kwargs):
        super().__init__(model=model, **kwargs)
        from src.config.settings import get_settings
        if get_settings().ROOT_WORK_LLM_CAPACITY_ENABLED:
            from src.root_runtime.model_capacity import CapacityClient
            object.__setattr__(self, 'llm_client', CapacityClient(self.llm_client))

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        trace = get_current_conversation_latency_trace()
        is_primary_call = bool(trace is not None and trace.claim_first_model_call())
        if is_primary_call:
            trace.mark_llm_request_start()
            counts: Optional[Tuple[int, int, int, bool]] = _cheap_llm_counts(llm_request)
        else:
            counts = None

        if is_primary_call:
            # One summary per turn, just before the provider pipeline starts.
            emit_runner_pre_model_log(
                trace,
                session_id=str(trace.session_id or ""),
                agent_name=str(trace.diagnostics.agent_name or "unknown"),
                llm_counts=counts,
            )

        from src.root_runtime.model_capacity import CapacityClient
        capacity = self.llm_client if isinstance(self.llm_client, CapacityClient) else None
        token = capacity.begin() if capacity else None
        try:
            provider = self
            if not any(tool.function_declarations for tool in llm_request.config.tools or []):
                # A request can lose its last tool after skill activation. Keep
                # this adjustment local: the model may serve concurrent requests.
                provider = self.model_copy()
                provider._additional_args = {key: value for key, value in self._additional_args.items()
                    if key != 'parallel_tool_calls'}
            from src.smart_rag.infrastructure.monitoring.model_response_recovery import recover_empty_response
            async with aclosing(recover_empty_response(super(InstrumentedLiteLlm, provider).generate_content_async, llm_request, stream, self.model)) as responses:
                async for response in responses:
                    if is_primary_call:
                        trace.mark_llm_first_delta()
                    yield response
        finally:
            if capacity:
                await capacity.end(token)


class InstrumentedResponsesLlm(OpenAIResponsesLlm):
    """Native Responses with private session history and conversation gates."""

    history_mode: Literal['application', 'provider'] = 'application'
    reasoning_history: Literal['none', 'last', 'all', 'auto'] = 'none'
    summary_mode: Literal['off', 'auto', 'concise', 'detailed'] = 'off'

    @cached_property
    def _openai_client(self):
        client = super()._openai_client
        from src.config.settings import get_settings
        if getattr(get_settings(), 'ROOT_WORK_LLM_CAPACITY_ENABLED', False):
            from src.root_runtime.model_capacity import CapacityClient
            return SimpleNamespace(responses=CapacityClient(client.with_options(max_retries=0).responses))
        return client

    def _get_response_create_kwargs(self, llm_request, *, stream):
        # Never mutate a shared request or attach provider-owned conversation state.
        request = llm_request.model_copy(update={'previous_interaction_id': None})
        kwargs = super()._get_response_create_kwargs(request, stream=stream)
        from .responses_history import prepare
        pending = prepare(self, llm_request, kwargs)
        object.__setattr__(llm_request, '_responses_pending', pending)
        if not kwargs.get('tools'):
            kwargs.pop('parallel_tool_calls', None)
            kwargs.pop('tool_choice', None)
        return kwargs

    async def generate_content_async(self, llm_request, stream=False):
        trace = get_current_conversation_latency_trace()
        primary = trace is not None and trace.claim_first_model_call()
        if primary:
            trace.mark_llm_request_start()
            emit_runner_pre_model_log(
                trace, session_id=str(trace.session_id or ''),
                agent_name=str(trace.diagnostics.agent_name or 'unknown'),
                llm_counts=_cheap_llm_counts(llm_request),
            )
        from src.root_runtime.model_capacity import CapacityClient
        from src.smart_rag.infrastructure.monitoring.model_response_recovery import recover_empty_response, ResponsesStream
        resource = self._openai_client.responses
        capacity = resource if isinstance(resource, CapacityClient) else None
        token = capacity.begin() if capacity else None
        streams = []
        async def create(**kwargs):
            from openai import BadRequestError, NotFoundError
            try:
                result = await resource.create(**kwargs)
            except (BadRequestError, NotFoundError) as error:
                # Retry only an explicit rejected/expired lineage, never an
                # uncertain dispatch, a tool failure or an alternate API.
                if not kwargs.get('previous_response_id') or error.code not in (
                    'previous_response_not_found', 'response_not_found',
                ):
                    raise
                from .responses_history import select_reasoning
                kwargs.pop('previous_response_id')
                kwargs['input'] = select_reasoning(llm_request._responses_pending['items'], self.reasoning_history)
                result = await resource.create(**kwargs)
            if kwargs.get('stream'):
                if not capacity:
                    result = ResponsesStream(result)
                streams.append(result)
            return result
        provider = self.model_copy()
        provider.__dict__['_openai_client'] = SimpleNamespace(responses=SimpleNamespace(create=create))
        try:
            async with aclosing(recover_empty_response(
                super(InstrumentedResponsesLlm, provider).generate_content_async, llm_request, stream, self.model,
            )) as responses:
                async for response in responses:
                    # Capture the original ordered provider output before stripping
                    # opaque replay material from every public ADK event.
                    metadata = (response.custom_metadata or {}).get('openai_response', {})
                    if metadata.get('status') == 'completed' and 'output' in metadata:
                        import copy
                        from .responses_history import projection
                        pending = copy.deepcopy(getattr(llm_request, '_responses_pending', {}))
                        if pending:
                            output = metadata['output']
                            pending['items'].extend(output)
                            if response.content:
                                projected = super()._get_response_input(LlmRequest(contents=[response.content]))
                                pending['projection'].extend(projection(projected))
                            pending['response_id'] = metadata.get('id')
                            object.__setattr__(response, '_responses_commit', pending)
                    if response.content:
                        for part in response.content.parts or []:
                            part.thought_signature = None
                        if self.summary_mode == 'off':
                            response.content.parts = [part for part in response.content.parts or [] if not part.thought]
                    if response.custom_metadata and 'openai_response' in response.custom_metadata:
                        # Only lifecycle metadata is needed by the activity renderer.
                        response.custom_metadata = {'openai_response': {
                            key: metadata[key] for key in ('id', 'status', 'stream_event') if key in metadata
                        }}
                    if primary:
                        trace.mark_llm_first_delta()
                    yield response
        finally:
            try:
                for opened in streams:
                    close = getattr(opened, 'aclose', None) or opened.close
                    await close()
            finally:
                if capacity:
                    await capacity.end(token)
