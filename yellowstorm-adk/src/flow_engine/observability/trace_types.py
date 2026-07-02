from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class ToolTraceItem:
    call_index: int
    tool_name: str
    args: dict[str, Any] = field(default_factory=dict)
    output_summary: str | None = None
    status: str | None = None
    duration_ms: int | None = None
    error: str | None = None


@dataclass(slots=True)
class LLMPromptTraceItem:
    stage: str
    model: str
    prompt: str
    generated_output: str | None = None


@dataclass(slots=True)
class UsageSummary:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    model: str | None = None
