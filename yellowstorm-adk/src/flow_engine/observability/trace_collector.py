from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from src.flow_engine.observability.redaction import (
    MAX_OUTPUT_SUMMARY_LENGTH,
    MAX_PROMPT_LENGTH,
    redact_string,
    redact_value,
)
from src.flow_engine.observability.trace_types import (
    LLMPromptTraceItem,
    ToolTraceItem,
    UsageSummary,
)

logger = logging.getLogger(__name__)


class TraceCollector:
    def __init__(self) -> None:
        self._tool_trace: list[ToolTraceItem] = []
        self._llm_prompt_trace: list[LLMPromptTraceItem] = []
        self._usage: UsageSummary | None = None
        self._next_call_index = 0
        self._observed_intent_key: str | None = None

    def set_observed_intent_key(self, key: str | None) -> None:
        self._observed_intent_key = key

    def record_prompt(self, stage: str, model: str, prompt: str) -> None:
        self._llm_prompt_trace.append(
            LLMPromptTraceItem(
                stage=stage,
                model=model,
                prompt=redact_string(prompt, MAX_PROMPT_LENGTH),
            )
        )

    def record_tool_call(
        self,
        *,
        tool_name: str,
        args: dict[str, Any],
        output_summary: str | None,
        status: str,
        duration_ms: int | None,
        error: str | None = None,
    ) -> None:
        call_index = self._next_call_index
        self._next_call_index += 1
        self._tool_trace.append(
            ToolTraceItem(
                call_index=call_index,
                tool_name=tool_name,
                args=redact_value(args),
                output_summary=redact_string(output_summary or "", MAX_OUTPUT_SUMMARY_LENGTH) if output_summary is not None else None,
                status=status,
                duration_ms=duration_ms,
                error=redact_string(error, MAX_OUTPUT_SUMMARY_LENGTH) if error else None,
            )
        )

    def record_usage(self, usage: UsageSummary | None) -> None:
        if usage is None:
            return
        if self._usage is None:
            self._usage = usage
            return
        self._usage = UsageSummary(
            input_tokens=_sum_optional(self._usage.input_tokens, usage.input_tokens),
            output_tokens=_sum_optional(self._usage.output_tokens, usage.output_tokens),
            total_tokens=_sum_optional(self._usage.total_tokens, usage.total_tokens),
            model=usage.model or self._usage.model,
        )

    def build_payload(self) -> dict[str, Any]:
        if not self._tool_trace and not self._llm_prompt_trace:
            logger.warning("No tool trace or LLM prompt trace captured during execution")
        elif not self._tool_trace and self._llm_prompt_trace:
            logger.warning("No tool trace captured: execution had LLM prompts but no tool calls")
        payload: dict[str, Any] = {
            "tool_trace": [asdict(item) for item in self._tool_trace],
            "llm_prompt_trace": [asdict(item) for item in self._llm_prompt_trace],
            "trace_metadata": {
                "tool_trace_count": len(self._tool_trace),
                "llm_prompt_trace_count": len(self._llm_prompt_trace),
                **({"observed_intent_key": self._observed_intent_key} if self._observed_intent_key is not None else {}),
            },
        }
        if self._usage is not None:
            payload["usage"] = asdict(self._usage)
        return payload


def _sum_optional(left: int | None, right: int | None) -> int | None:
    if left is None and right is None:
        return None
    return int(left or 0) + int(right or 0)
