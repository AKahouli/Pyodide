"""Bounded planning turn runner.

Per canonical §4.3: each planning turn is a single bounded invocation
— load context → reason → emit delta + response → exit. No long-lived
loops. Persist nothing locally (backend is authority).

Implementation:
  - Build a per-turn `LlmAgent` (cheap).
  - Use the standard ADK pattern: `InMemorySessionService` +
    `Runner.run_async(user_id, session_id, new_message)`.
  - The agent's `submit_plan_delta` tool validates the body and yields
    a `delta.pending` frame with the parsed `PlanDeltaBody` payload.
    The planning router consumes the frame and posts to the backend
    with the correct `streamId` (the runner is per-app; the stream is
    per-request). On ack, the router yields `planning.delta.applied`.
  - The agent's `clarification` tool yields an `interaction.requested`
    frame with the question/options; the router posts a
    `WorkyInteraction` to the backend (`request_interaction`) and the
    owner responds via `POST /worky/interactions/{id}/respond` which
    triggers a follow-up turn.

Validation failures from the tool surface back to the agent as
`validation_error`; the agent can retry ONCE. After one retry fails,
the runner falls back to a clarification so the owner can course-correct.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import AsyncIterator, Callable, Optional

from .schemas import PlanDeltaBody
from .manager import build_manager_agent

logger = logging.getLogger("worky.runner")


class PlanningFrame:
    __slots__ = ("type", "emitted_at", "payload")

    def __init__(self, type_: str, payload: dict, emitted_at: float | None = None):
        self.type = type_
        self.payload = payload
        self.emitted_at = emitted_at if emitted_at is not None else time.time()

    def to_dict(self) -> dict:
        return {"type": self.type, "emitted_at": self.emitted_at, "payload": self.payload}


def build_runner() -> Callable[..., AsyncIterator[PlanningFrame]]:
    """Build the runner closure.

    The runner is app-scoped (no per-stream state) — the router
    attaches the stream id when it forwards a `delta.pending` frame to
    the backend.
    """

    async def run_turn(
        owner_message: str,
        context_snapshot: dict | None = None,
        manager_model_id: Optional[str] = None,
    ) -> AsyncIterator[PlanningFrame]:
        # Import lazily so unit tests can monkeypatch the agent.
        try:
            from google.adk.runners import Runner
            from google.adk.sessions import InMemorySessionService
            from google.genai import types as genai_types
        except Exception:  # pragma: no cover
            yield PlanningFrame(
                "planning.error",
                {"error": "google-adk is not installed"},
            )
            return

        # If this turn is the resolution of a previous clarification,
        # prepend the original question/options to the owner message
        # so the Manager has the question text in-context. The full
        # snapshot is also passed through to the agent via the
        # session, but ADK's `new_message` is the only slot the
        # LLM-visible user turn occupies.
        snapshot = context_snapshot or {}
        previous_clarification = snapshot.get("previousClarification") or snapshot.get(
            "previous_clarification"
        )
        effective_message = owner_message
        if isinstance(previous_clarification, dict):
            prev_q = str(previous_clarification.get("question") or "").strip()
            prev_options = previous_clarification.get("options") or []
            if prev_q:
                option_lines = (
                    "\n".join(f"- {o}" for o in prev_options) if prev_options else ""
                )
                effective_message = (
                    f"Owner answered the previous clarification question.\n"
                    f"Question: {prev_q}\n"
                    + (f"Options previously offered:\n{option_lines}\n" if option_lines else "")
                    + owner_message
                )

        # 1) Ack the turn
        yield PlanningFrame(
            "planning.ack",
            {
                "owner_message": owner_message,
                "context_snapshot": snapshot,
                "manager_model_id": manager_model_id,
            },
        )

        # 2) Build the per-turn agent. The tool callbacks DON'T make
        # network calls — they stash the parsed payload so the runner
        # can yield it as a frame. The router (which knows the
        # streamId) does the actual backend call.
        delta_holder: dict = {"delta": None, "asked": None}

        def on_submit_delta(parsed: PlanDeltaBody) -> None:
            delta_holder["delta"] = parsed

        def on_clarification(question: str, options: list[str] | None) -> None:
            delta_holder["asked"] = (question, options)

        try:
            agent = build_manager_agent(
                on_submit_delta=on_submit_delta,
                on_clarification=on_clarification,
                model_id=manager_model_id,
            )
        except Exception as exc:  # noqa: BLE001
            # `build_model` raises RuntimeError when no model id AND
            # no env endpoint is configured. Surface a clear error
            # frame so the owner sees a real reason, not a silent
            # timeout. Backend is expected to reject earlier in the
            # chain; this is the runtime-side safety net.
            logger.exception("Manager agent build failed")
            yield PlanningFrame(
                "planning.error",
                {"error": f"manager model not configured: {exc}"},
            )
            return
        session_service = InMemorySessionService()
        user_id = "owner"
        session_id = f"worky-turn-{int(time.time() * 1000)}"
        await session_service.create_session(
            app_name="worky_runtime",
            user_id=user_id,
            session_id=session_id,
        )
        runner = Runner(
            agent=agent,
            app_name="worky_runtime",
            session_service=session_service,
        )

        new_message = genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=effective_message)],
        )

        assistant_text = ""
        # ADK's `Runner.run_async` keeps iterating until the LLM emits a
        # final response with no tool call. The Manager's only productive
        # actions are `submit_plan_delta` and `request_input` — once
        # either fires the turn is done. Bailing out here keeps the
        # bounded-turn invariant (§4.3) and prevents the LLM from
        # looping on follow-up "verification" calls or repeated
        # clarifications. We also enforce a hard upper bound as a
        # safety net against infinite loops from any cause.
        max_events = 64
        events_seen = 0
        try:
            async for event in runner.run_async(
                user_id=user_id,
                session_id=session_id,
                new_message=new_message,
            ):
                events_seen += 1
                # Surface assistant text as token frames for live streaming.
                content = getattr(event, "content", None)
                if content and getattr(content, "parts", None):
                    for part in content.parts:
                        text = getattr(part, "text", None)
                        if text:
                            assistant_text += text
                            yield PlanningFrame("planning.token", {"text": text})
                # The Manager just made a real decision — stop here.
                if (
                    delta_holder["delta"] is not None
                    or delta_holder["asked"] is not None
                ):
                    break
                if events_seen >= max_events:
                    logger.warning(
                        "Runner exceeded %d events; terminating turn to avoid loop",
                        max_events,
                    )
                    break
        except Exception as exc:  # noqa: BLE001
            logger.exception("Runner raised during turn")
            yield PlanningFrame("planning.error", {"error": str(exc)})
            return

        # 3) Emit the result frame based on what happened.
        if delta_holder["delta"] is not None:
            yield PlanningFrame(
                "delta.pending",
                {"body": delta_holder["delta"].model_dump(exclude_none=True)},
            )
        elif delta_holder["asked"] is not None:
            question, options = delta_holder["asked"]
            yield PlanningFrame(
                "interaction.requested",
                {"question": question, "options": options or []},
            )
        if assistant_text:
            yield PlanningFrame(
                "assistant.message",
                {"text": assistant_text},
            )
        # 4) Terminal frame
        yield PlanningFrame("planning.done", {"turn": session_id})

    return run_turn
