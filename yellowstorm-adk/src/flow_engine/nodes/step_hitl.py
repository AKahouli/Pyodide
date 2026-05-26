"""Human-in-the-loop helpers for step nodes.

Provides payload construction, response parsing, and prompt helpers
used by the HITL handler functions in step_hitl_handlers.py.
"""

from __future__ import annotations

import json
import re
from typing import Any

from structlog import get_logger

logger = get_logger(__name__)

SKIP_STEP_REASON = "__skip_step__"


def _meta_get(metadata: dict[str, Any], snake_key: str, camel_key: str, default: Any = None) -> Any:
    return metadata.get(snake_key, metadata.get(camel_key, default))


def _flag(metadata: dict[str, Any], snake_key: str, camel_key: str) -> bool:
    return bool(metadata.get(snake_key) or metadata.get(camel_key))


def needs_hitl(metadata: dict[str, Any]) -> bool:
    return bool(
        _flag(metadata, "interrupt_before", "interruptBefore")
        or _flag(metadata, "interrupt_after", "interruptAfter")
        or _flag(metadata, "allow_clarification", "allowClarification")
    )


def _build_interrupt_payload(
    interrupt_type: str,
    message: str,
    *,
    node_id: str,
    label: str,
    node_description: str = "",
    result_text: str = "",
    round_number: int = 1,
    transcript: list[dict[str, str]] | None = None,
    resumable_actions: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": interrupt_type,
        "task_id": node_id,
        "task_title": label,
        "task_description": node_description,
        "result": result_text,
        "message": message,
        "interrupt_id": f"{node_id}:{interrupt_type}:{round_number}",
        "round": round_number,
        "conversation_json": json.dumps(transcript or []),
        "resumable_actions": resumable_actions or ["reply"],
    }


def is_skip_step_response(response: Any) -> bool:
    return (
        isinstance(response, dict)
        and response.get("approved") is False
        and response.get("reason") == SKIP_STEP_REASON
    )


def normalize_interrupt_action(response: Any, interrupt_type: str) -> str:
    if is_skip_step_response(response):
        return "skip"
    if isinstance(response, dict):
        action = str(response.get("action") or "").strip().lower()
        if action in {"reply", "approve", "reject", "skip"}:
            return action
        if response.get("approved") is True:
            return "approve"
        if response.get("approved") is False:
            if interrupt_type == "review_request" and (
                response.get("feedback") or response.get("message")
            ):
                return "reply"
            return "reject"
    return "reply" if interrupt_type == "clarification" else "approve"


def extract_interrupt_message(response: Any) -> str:
    if isinstance(response, str):
        return response.strip()
    if isinstance(response, dict):
        for key in ("message", "feedback", "input", "reason"):
            value = response.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def extract_follow_up_question(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    normalized = text.strip()
    if not normalized or "?" not in normalized:
        return ""
    lines = [line.strip(" -*\t") for line in normalized.splitlines() if line.strip()]
    for line in reversed(lines):
        if "?" in line:
            return line[-500:]
    match = re.search(r"([^?.!\n][^?\n]{0,400}\?)\s*$", normalized)
    if match:
        return match.group(1).strip()
    return ""


def build_clarification_pre_prompt(
    label: str,
    node_description: str,
    clarification_prompt: str = "",
    user_query: str = "",
    user_language: str = "en",
) -> str:
    prompt = clarification_prompt or (
        "Review the task below and determine if you have enough information to complete it.\n"
        f"Task: {label}\n"
        f"Description: {node_description}\n"
        "If you need clarification, respond with one clear question only. "
        "If everything is clear, respond with exactly 'CLEAR'."
    )
    prompt = prompt.replace("{{UserLanguage}}", user_language or "en")
    blocks: list[str] = [prompt]
    blocks.append(f"Task title: {label}")
    blocks.append(f"Task description:\n{node_description}")
    if user_query.strip():
        blocks.append(f"User request:\n{user_query.strip()}")
    blocks.append(
        "For this pre-check, treat missing company names, time ranges, targets, data sources, deliverable format, "
        "or any other essential requirement as insufficient information. If anything essential is missing or ambiguous, "
        "ask exactly one clarification question. Otherwise respond with exactly 'CLEAR'."
    )
    return "\n\n".join(blocks)


class StepHitlResult:
    __slots__ = ("skipped", "failed", "error_msg", "updated_description", "output_override", "needs_reexec")

    def __init__(self) -> None:
        self.skipped = False
        self.failed = False
        self.error_msg = ""
        self.updated_description: str | None = None
        self.output_override: str | None = None
        self.needs_reexec = False
