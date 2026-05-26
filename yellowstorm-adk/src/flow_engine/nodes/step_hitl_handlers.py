"""HITL handler functions for step nodes.

Each handler performs one HITL phase (clarification_before, interrupt_before,
clarification_after, interrupt_after) and returns a StepHitlResult.

On LangGraph resume, the node replays from the top. The caller (step.py)
persists LLM output in state.hitl_checkpoint so post-exec handlers can
be reached without re-running the LLM.
"""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import HumanMessage
from langgraph.types import interrupt
from structlog import get_logger

from src.config.settings import get_settings
from src.middleware.correlation import get_user
from src.flow_engine.nodes.step_hitl import (
    StepHitlResult,
    _build_interrupt_payload,
    _flag,
    _meta_get,
    build_clarification_pre_prompt,
    extract_follow_up_question,
    extract_interrupt_message,
    normalize_interrupt_action,
)

logger = get_logger(__name__)


async def handle_clarification_before(
    node_id: str,
    label: str,
    node_description: str,
    metadata: dict[str, Any],
    model_id: str,
    writer: Callable,
    *,
    user_query: str = "",
    user_language: str = "en",
) -> StepHitlResult:
    result = StepHitlResult()
    if not _flag(metadata, "allow_clarification", "allowClarification"):
        return result

    from langchain_openai import ChatOpenAI

    settings = get_settings()
    clarification_limit = max(int(_meta_get(metadata, "max_clarifications", "maxClarifications") or 0), 0)
    clarification_prompt_text = str(_meta_get(metadata, "clarification_prompt", "clarificationPrompt") or "").strip()

    llm = ChatOpenAI(
        base_url=settings.LITELLM_API_BASE_URL,
        api_key=settings.LITELLM_API_SECRET_KEY,
        model=model_id,
        temperature=0.0,
        model_kwargs={"user": get_user()},
    )

    clarification_resolved = False
    for round_number in range(1, clarification_limit + 1):
        prompt = build_clarification_pre_prompt(
            label=label,
            node_description=node_description,
            clarification_prompt=clarification_prompt_text,
            user_query=user_query,
            user_language=user_language,
        )
        check_result = await llm.ainvoke([HumanMessage(content=prompt)])
        check_text = check_result.content.strip()

        if check_text.upper() == "CLEAR":
            clarification_resolved = True
            break

        payload = _build_interrupt_payload(
            "clarification",
            check_text,
            node_id=node_id,
            label=label,
            node_description=node_description,
            round_number=round_number,
            resumable_actions=["reply", "skip"],
        )
        writer({"type": "NodeSuspended", "node_id": node_id, "payload": payload})
        response = interrupt(payload)
        action = normalize_interrupt_action(response, "clarification")

        if action == "skip":
            result.skipped = True
            return result

        user_reply = extract_interrupt_message(response)
        if not user_reply:
            result.failed = True
            result.error_msg = "Clarification response was empty"
            return result

        node_description = f"{node_description}\n\nClarification from user: {user_reply}"
        result.updated_description = node_description
        clarification_resolved = True
        break

    if clarification_limit == 0:
        return result

    if not clarification_resolved:
        result.failed = True
        result.error_msg = "Clarification limit exceeded"
        return result

    return result


async def handle_interrupt_before(
    node_id: str,
    label: str,
    node_description: str,
    metadata: dict[str, Any],
    writer: Callable,
) -> StepHitlResult:
    result = StepHitlResult()
    if not _flag(metadata, "interrupt_before", "interruptBefore"):
        return result

    logger.info("[hitl] Approval required before execution", node_id=node_id)

    payload = _build_interrupt_payload(
        "approval_request",
        f"Task '{label}' requires approval before execution.",
        node_id=node_id,
        label=label,
        node_description=node_description,
        resumable_actions=["approve", "reject", "skip"],
    )
    writer({"type": "NodeSuspended", "node_id": node_id, "payload": payload})
    response = interrupt(payload)
    action = normalize_interrupt_action(response, "approval_request")

    if action == "skip":
        result.skipped = True
        return result

    if action == "reject":
        result.failed = True
        result.error_msg = extract_interrupt_message(response) or "Task rejected by human"
        return result

    feedback = extract_interrupt_message(response)
    if feedback and action == "approve":
        result.updated_description = f"{node_description}\n\nHuman Feedback: {feedback}"

    return result


async def handle_clarification_after(
    node_id: str,
    label: str,
    node_description: str,
    metadata: dict[str, Any],
    output: str,
    writer: Callable,
) -> StepHitlResult:
    result = StepHitlResult()
    if not _flag(metadata, "allow_clarification", "allowClarification"):
        return result

    follow_up = extract_follow_up_question(output)
    if not follow_up:
        return result

    clarification_limit = max(int(_meta_get(metadata, "max_clarifications", "maxClarifications") or 0), 0)
    if clarification_limit <= 0:
        return result

    transcript: list[dict[str, str]] = [{"role": "assistant", "content": output}]
    clarification_round = 1

    payload = _build_interrupt_payload(
        "clarification",
        follow_up,
        node_id=node_id,
        label=label,
        node_description=node_description,
        result_text=output,
        round_number=clarification_round,
        transcript=transcript,
        resumable_actions=["reply", "skip"],
    )
    writer({"type": "NodeSuspended", "node_id": node_id, "payload": payload})
    response = interrupt(payload)
    action = normalize_interrupt_action(response, "clarification")

    if action == "skip":
        result.skipped = True
        return result

    user_reply = extract_interrupt_message(response)
    if not user_reply:
        result.failed = True
        result.error_msg = "Clarification response was empty"
        return result

    transcript.append({"role": "user", "content": user_reply})
    node_description = f"{node_description}\n\nClarification from user: {user_reply}"
    result.updated_description = node_description
    result.output_override = None
    return result


async def handle_interrupt_after(
    node_id: str,
    label: str,
    node_description: str,
    metadata: dict[str, Any],
    output: str,
    writer: Callable,
) -> StepHitlResult:
    result = StepHitlResult()
    if not _flag(metadata, "interrupt_after", "interruptAfter"):
        return result

    logger.info("[hitl] Review required after execution", node_id=node_id)
    review_transcript: list[dict[str, str]] = []
    review_round = 0

    while True:
        review_round += 1
        payload = _build_interrupt_payload(
            "review_request",
            (
                f"Task '{label}' completed. Please review the result."
                if review_round == 1
                else f"Review the revised result for task '{label}'."
            ),
            node_id=node_id,
            label=label,
            node_description=node_description,
            result_text=output,
            round_number=review_round,
            transcript=review_transcript,
            resumable_actions=["reply", "approve", "reject", "skip"],
        )
        writer({"type": "NodeSuspended", "node_id": node_id, "payload": payload})
        response = interrupt(payload)
        action = normalize_interrupt_action(response, "review_request")

        if action == "skip":
            result.skipped = True
            return result

        if action == "reject":
            result.failed = True
            result.error_msg = extract_interrupt_message(response) or "Task result rejected by human"
            return result

        if action == "approve":
            return result

        feedback = extract_interrupt_message(response)
        if not feedback:
            return result

        review_transcript.append({"role": "assistant", "content": output})
        review_transcript.append({"role": "user", "content": feedback})
        result.updated_description = f"{node_description}\n\nHuman Review Feedback: {feedback}"
        result.needs_reexec = True
        return result
