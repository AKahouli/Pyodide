"""Planning router — owner ↔ Manager conversational planning.

`POST /runtime/streams/{id}/planning-turn` accepts the owner's prompt
plus a context snapshot, runs one bounded Manager turn (canonical §4)
via `app.agents.runner`, and relays the resulting frames as SSE
(`event: <type>` / `data: {…}`).

The Manager agent's `submit_plan_delta` tool posts a structured delta
to the backend (`POST /worky/internal/streams/{id}/plan-delta`) with
a per-call `X-Event-Id`. When that returns a successful ack, the
runtime emits `planning.delta.applied` to the client SSE channel.

The runtime never writes state directly to Mongo. All mutations are
state-change requests sent to NestJS at `/worky/internal/*` with a
service-token + idempotency key.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Path, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..clients import BackendClient

logger = logging.getLogger("worky.planning")
router = APIRouter(prefix="/runtime/streams", tags=["planning"])


class PlanningTurnRequest(BaseModel):
    owner_message: str = Field(..., min_length=1, max_length=16384)
    context_snapshot: dict | None = None
    # Per-turn model selection. Both are LiteLLM model identifiers
    # (e.g. `gpt-4o-mini`), never admin DB ids. The runtime passes
    # them straight to `LiteLlm(model=...)` via `build_model()`.
    # The backend is responsible for resolving the fallback chain
    # (per-turn override → stream persistent → admin default); the
    # runtime never queries the admin DB itself.
    manager_model_id: str | None = Field(default=None, max_length=256)
    worker_model_id: str | None = Field(default=None, max_length=256)


class PlanningEvent(BaseModel):
    type: str
    emitted_at: float
    payload: dict


@router.post("/{stream_id}/planning-turn")
async def planning_turn(
    request: Request,
    stream_id: str = Path(..., description="Worky stream id"),
    body: PlanningTurnRequest | None = None,
) -> StreamingResponse:
    if body is None:
        raise HTTPException(status_code=400, detail="Request body is required")
    run_turn = getattr(request.app.state, "run_planning_turn", None)
    if run_turn is None:
        raise HTTPException(status_code=503, detail="Runtime not initialized")
    backend: BackendClient = request.app.state.backend_client

    async def event_stream() -> AsyncIterator[str]:
        # The runner may take a few hundred ms to start; flush a
        # synthetic ack immediately so proxies don't buffer.
        yield _sse_frame(
            PlanningEvent(
                type="planning.bootstrap",
                emitted_at=asyncio.get_event_loop().time(),
                payload={
                    "stream_id": stream_id,
                    "manager_model_id": body.manager_model_id,
                    "worker_model_id": body.worker_model_id,
                },
            )
        )
        try:
            async for frame in run_turn(
                body.owner_message,
                body.context_snapshot,
                body.manager_model_id,
            ):
                # Translate the runner's internal frames into the wire
                # contract that NestJS understands.
                if frame.type == "delta.pending":
                    delta_body = frame.payload.get("body", {})
                    # Forward the real basePlanVersion from the
                    # context snapshot — the backend rejects any delta
                    # whose basePlanVersion does not match the
                    # stream's currentPlanVersion (canonical §6).
                    snapshot = body.context_snapshot or {}
                    base_plan_version = snapshot.get("planVersion", 0)
                    if not isinstance(base_plan_version, int) or base_plan_version < 0:
                        base_plan_version = 0
                    payload = {"basePlanVersion": base_plan_version, "body": delta_body}
                    callback_name = _delta_callback_name_for_status(snapshot.get("status"))
                    try:
                        ack = await getattr(backend, callback_name)(stream_id, payload)
                        yield _sse_frame(
                            PlanningEvent(
                                type="planning.delta.applied",
                                emitted_at=frame.emitted_at,
                                payload={"stream_id": stream_id, "ack": ack},
                            )
                        )
                    except Exception as exc:  # noqa: BLE001
                        logger.exception("plan-delta callback failed")
                        yield _sse_frame(
                            PlanningEvent(
                                type="planning.error",
                                emitted_at=frame.emitted_at,
                                payload={"error": str(exc), "phase": "plan-delta"},
                            )
                        )
                    continue
                if frame.type == "interaction.requested":
                    question = frame.payload.get("question", "")
                    options = frame.payload.get("options") or []
                    try:
                        ack = await backend.request_interaction(
                            stream_id,
                            {
                                "type": "clarification",
                                "question": question,
                                "options": options,
                            },
                        )
                    except Exception as exc:  # noqa: BLE001
                        logger.exception("interaction callback failed")
                        yield _sse_frame(
                            PlanningEvent(
                                type="planning.error",
                                emitted_at=frame.emitted_at,
                                payload={"error": str(exc), "phase": "interaction"},
                            )
                        )
                    else:
                        yield _sse_frame(
                            PlanningEvent(
                                type="interaction.requested",
                                emitted_at=frame.emitted_at,
                                payload={
                                    "stream_id": stream_id,
                                    "question": question,
                                    "options": options,
                                    "ack": ack,
                                },
                            )
                        )
                    continue
                # All other frames pass through unchanged.
                yield _sse_frame(
                    PlanningEvent(
                        type=frame.type,
                        emitted_at=frame.emitted_at,
                        payload=frame.payload,
                    )
                )
        except Exception as exc:  # pragma: no cover — exercised via integration
            logger.exception("planning-turn failed")
            yield _sse_frame(
                PlanningEvent(
                    type="planning.error",
                    emitted_at=asyncio.get_event_loop().time(),
                    payload={"error": str(exc)},
                )
            )
        # SSE warmup: keep the response body from being buffered by proxies
        await asyncio.sleep(0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _sse_frame(event: PlanningEvent) -> str:
    """Render one named SSE event (`event: <type>`) with JSON data."""
    return f"event: {event.type}\ndata: {json.dumps(event.model_dump())}\n\n"


def _delta_callback_name_for_status(status: object) -> str:
    """Choose planning vs replan callback from the backend snapshot status."""
    # Keep this pre-execution set in sync with
    # WorkyPlanDeltaService.isPreExecutionPhase in NestJS.
    if status in {None, "created", "planning", "start_validation_failed"}:
        return "plan_delta"
    return "replan"
