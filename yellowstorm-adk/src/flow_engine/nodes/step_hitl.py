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

FEEDBACK_SCOPES = {
    "step_only",
    "downstream_run",
    "entire_run",
    "future_node_runs",
    "future_workflow_runs",
}
CURRENT_RUN_CONTEXT_SCOPES = {"downstream_run", "entire_run"}

SKIP_STEP_REASON = "__skip_step__"
IGNORE_CLARIFICATION_REPLIES = {
    "ignore",
    "skip clarification",
    "continue",
    "proceed",
    "proceed with available information",
    "use available information",
    "no more clarification",
    "no more clarifications",
}


def _meta_get(metadata: dict[str, Any], snake_key: str, camel_key: str, default: Any = None) -> Any:
    return metadata.get(snake_key, metadata.get(camel_key, default))


def _flag(metadata: dict[str, Any], snake_key: str, camel_key: str) -> bool:
    return bool(metadata.get(snake_key) or metadata.get(camel_key))


def should_proceed_without_more_clarification(user_reply: str) -> bool:
    normalized_reply = " ".join(user_reply.strip().casefold().split())
    if normalized_reply in IGNORE_CLARIFICATION_REPLIES:
        return True
    ignore_words = ("ignore", "skip", "proceed", "continue")
    return any(
        normalized_reply == word or normalized_reply.startswith(f"{word} ")
        for word in ignore_words
    )


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
    reason_code: str = "manual_hitl",
    risk_level: str = "medium",
    feedback_scope_default: str = "downstream_run",
    blocker_rule_id: str | None = None,
    blocker_kind: str | None = None,
    downstream_node_ids: list[str] | None = None,
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
        "reason_code": reason_code,
        "risk_level": risk_level,
        "feedback_scope_default": feedback_scope_default,
        "blocker_rule_id": blocker_rule_id,
        "blocker_kind": blocker_kind,
        "downstream_node_ids": downstream_node_ids or [],
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


def build_blocker_judge_prompt(
    label: str,
    node_description: str,
    input_context: dict[str, Any],
    blockers: list[dict[str, Any]],
    feedback_history: list[dict[str, str]] | None = None,
) -> str:
    blocker_lines: list[str] = []
    seen_blockers: set[str] = set()
    for blocker in blockers:
        matcher_config = blocker.get("matcherConfig") or blocker.get("matcher_config") or {}
        natural_rule = matcher_config.get("naturalLanguageRule") or matcher_config.get("natural_language_rule") if isinstance(matcher_config, dict) else ""
        blocker_payload = {
            "id": blocker.get("id"),
            "kind": blocker.get("kind"),
            "action": blocker.get("action"),
            "label": blocker.get("label"),
            "description": blocker.get("description"),
            "naturalLanguageRule": natural_rule,
            "promptTemplate": blocker.get("promptTemplate") or blocker.get("prompt_template"),
        }
        blocker_key = json.dumps(
            {
                "kind": blocker_payload["kind"],
                "action": blocker_payload["action"],
                "label": blocker_payload["label"],
                "description": blocker_payload["description"],
                "naturalLanguageRule": blocker_payload["naturalLanguageRule"],
                "promptTemplate": blocker_payload["promptTemplate"],
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        if blocker_key in seen_blockers:
            continue
        seen_blockers.add(blocker_key)
        blocker_lines.append(json.dumps(blocker_payload, ensure_ascii=False))
    return "\n\n".join([
        "Must always Evaluate **every** configured human-in-the-loop blocker definition (listed below) to determine if it applies regarding the given task description and ask for clarification or approval if needed.",
        "Return exactly one JSON object and no markdown.",
        "If a blocker applies, return {\"decision\":\"block\",\"blocker_id\":\"...\",\"message\":\"one concise question or approval request for the user\"}.",
        "If no blocker applies, return {\"decision\":\"clear\"}.",
        "Do not invent missing user requirements. Judge only from the task, current inputs, and blocker definitions.",
        "When a blocker describes missing or ambiguous criteria that are still not provided, prefer block over clear.",
        "If prior user feedback is insufficient, contradictory, or too broad, block again and ask a better question with brief examples.",
        "For clarify actions, the message must be one direct user-facing question asking only for the missing information.",
        "For approval actions, the message must be one concise approval request.",
        f"Task title: {label}",
        f"Task description:\n{node_description}",
        f"Current inputs/context:\n{json.dumps(input_context, ensure_ascii=False, default=str)}",
        f"Prior HITL feedback:\n{json.dumps(feedback_history or [], ensure_ascii=False, default=str)}",
        "Blocker definitions:\n" + "\n".join(blocker_lines),
    ])


def parse_blocker_judge_response(text: Any) -> dict[str, str] | None:
    if not isinstance(text, str) or not text.strip():
        return None
    raw = text.strip()
    if raw.upper() == "CLEAR":
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(parsed, dict) or str(parsed.get("decision") or "").lower() != "block":
        return None
    blocker_id = str(parsed.get("blocker_id") or parsed.get("blockerId") or "").strip()
    message = str(parsed.get("message") or "").strip()
    if not blocker_id or not message:
        return None
    return {"blocker_id": blocker_id, "message": message}


def extract_feedback_scope(response: Any, default_scope: str = "step_only") -> str:
    if not isinstance(response, dict):
        return default_scope
    scope = str(response.get("scope") or response.get("feedback_scope") or default_scope).strip()
    if scope in FEEDBACK_SCOPES:
        return scope
    return default_scope


def extract_remember_flag(response: Any) -> bool:
    return bool(isinstance(response, dict) and response.get("remember") is True)


def build_human_context_entry(
    response: Any,
    *,
    node_id: str,
    label: str,
    interrupt_type: str,
    message: str,
    default_scope: str = "step_only",
) -> dict[str, Any] | None:
    """Build reusable in-run guidance from scoped human feedback."""

    scope = extract_feedback_scope(response, default_scope)
    if scope not in CURRENT_RUN_CONTEXT_SCOPES:
        return None
    human_message = extract_interrupt_message(response)
    if not human_message:
        return None
    return {
        "node_id": node_id,
        "task_title": label,
        "interrupt_type": interrupt_type,
        "message": human_message,
        "scope": scope,
        "remember": extract_remember_flag(response),
        "source_message": message,
    }


class StepHitlResult:
    __slots__ = (
        "skipped",
        "failed",
        "error_msg",
        "updated_description",
        "output_override",
        "needs_reexec",
        "suppress_follow_up_clarification",
        "human_context",
    )

    def __init__(self) -> None:
        self.skipped = False
        self.failed = False
        self.error_msg = ""
        self.updated_description: str | None = None
        self.output_override: str | None = None
        self.needs_reexec = False
        self.suppress_follow_up_clarification = False
        self.human_context: list[dict[str, Any]] = []
