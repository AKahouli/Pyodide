"""Instrumented LiteLlm adapter for conversation latency instrumentation.

Wraps ``google.adk.models.lite_llm.LiteLlm`` to stamp the first model-call
boundaries (``llm.request_start`` / ``llm.first_delta``) on the request-scoped
:class:`~src.smart_rag.infrastructure.monitoring.conversation_latency.ConversationLatencyTrace`.

Hot-path cost is a ContextVar lookup plus scalar assignments — no request
serialization, logging, or I/O. When no trace is installed the wrapper is
behaviorally transparent.
"""

from __future__ import annotations

from typing import AsyncGenerator

from google.adk.models.lite_llm import LiteLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.models.llm_request import LlmRequest

from src.smart_rag.infrastructure.monitoring.conversation_latency import (
    get_current_conversation_latency_trace,
)


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

        async for response in super().generate_content_async(llm_request, stream=stream):
            if is_primary_call:
                trace.mark_llm_first_delta()
            yield response
