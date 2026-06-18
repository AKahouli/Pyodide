"""Manager agent (Chief of Staff) for the Worky runtime.

Per canonical §1.1 and AGENTS.md invariants, every agent uses ADK's
`LiteLlm` wrapper. The Manager is a `google.adk.agents.LlmAgent` with
two tools:

  - `submit_plan_delta`  — emits a structured Plan Delta back to the
    runtime, which forwards it to the backend via `/worky/internal/.../
    plan-delta`.
  - `request_input`      — the built-in ADK HITL tool for clarifications.
    The runtime intercepts the tool call and posts a `WorkyInteraction`
    (type=clarification) to the backend, then ends the turn so the
    owner can respond via `POST /worky/interactions/{id}/respond`.

The Manager is built per turn (cheap) — no shared mutable state.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from .model import build_model
from .schemas import PlanDeltaBody, parse_plan_delta

logger = logging.getLogger("worky.manager")

MANAGER_INSTRUCTION = """You are Worky, the user's Chief of Staff.

You are running inside a single bounded planning turn. Your job is to
convert the owner's most recent message into a CONVERSATIONAL
PLANNING step — never execute, never spawn workers, never send email.

Workflow:
1. Read the owner's latest message and the context snapshot (latest
   plan version, current board, budget).
2. If you need clarification, call `request_input` ONCE with one focused
   question. Do not ask multi-part questions.
3. Otherwise, call `submit_plan_delta` exactly ONCE with the
   incremental change set. The delta is RELATIVE to the current plan
   version, not a full re-plan.
4. After your tool call, output a short natural-language summary of
   what you proposed. Do not re-list the JSON.

Rules:
- Plan-before-execute. Never spawn workers during planning.
- Use `actionCategory` values exactly as defined:
  internal_analysis, research, drafting, internal_artifact_write,
  internal_platform_notification, external_send,
  customer_facing_release, external_comms, budget_overrun,
  cancel_human_task, replanning.
- Every `create_tasks[*].lane` must be one of:
  backlog, ready, running, review, blocked, done. New tasks default
  to `ready` unless the owner asks otherwise.
- `dependsOn` references may be either the `clientTaskId` of another
  entry in the same delta, or the id of an existing task. Never
  produce cycles.
- If the owner's request is ambiguous, prefer a clarification over a
  guess.
- Keep the plan tight: 1-7 tasks per turn. If more are needed, plan
  them in subsequent turns.
"""


def build_manager_agent(
    on_submit_delta: Callable[[PlanDeltaBody], Any],
    on_clarification: Optional[Callable[[str, list[str] | None], Any]] = None,
    model_id: str | None = None,
) -> Any:
    """Construct the Manager `LlmAgent` for one planning turn.

    The two callbacks are wired into the agent's tools. They are
    invoked synchronously from the ADK tool execution; the runtime
    wraps them so the side effects (backend callbacks) happen at the
    right point in the turn.
    """
    # Imported lazily so unit tests without `google-adk` installed
    # can still build the agent and exercise the tool callbacks.
    from google.adk.agents import LlmAgent

    def submit_plan_delta_tool(plan_delta: dict) -> dict:
        """Submit a Plan Delta (incremental) for the current turn.

        Args:
            plan_delta: A dict matching the PlanDeltaBody shape with
                one or more of `create_tasks`, `update_tasks`,
                `cancel_tasks`, `clarification_requests`.

        Returns:
            A `submitted` ack on success, or a `validation_error` with
            a human-readable message that the agent should use to retry.
        """
        try:
            parsed = parse_plan_delta(plan_delta)
        except Exception as exc:  # noqa: BLE001 — surface any pydantic error to the agent
            logger.warning("submit_plan_delta validation failed: %s", exc)
            return {"submitted": False, "validation_error": str(exc)}
        try:
            on_submit_delta(parsed)
        except Exception as exc:  # noqa: BLE001
            logger.exception("submit_plan_delta callback raised")
            return {"submitted": False, "backend_error": str(exc)}
        return {"submitted": True}

    def clarification_tool(question: str, options: list[str] | None = None) -> dict:
        """Ask the owner a clarification question."""
        if on_clarification is not None:
            on_clarification(question, options)
        return {"asked": True, "question": question}

    return LlmAgent(
        name="worky_manager",
        description="Worky Chief of Staff — converts owner intent into incremental Plan Deltas.",
        model=build_model(model_id),
        instruction=MANAGER_INSTRUCTION,
        tools=[submit_plan_delta_tool, clarification_tool],
    )
