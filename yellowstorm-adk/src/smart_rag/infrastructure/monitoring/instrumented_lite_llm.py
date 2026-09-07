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

from google.adk.models.lite_llm import LiteLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.models.llm_request import LlmRequest

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

        async for response in super().generate_content_async(llm_request, stream=stream):
            if is_primary_call:
                trace.mark_llm_first_delta()
            yield response
