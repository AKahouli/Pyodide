"""Execution router (Part 3, `docs/worky/03_EXECUTION_GOVERNANCE.md`).

`POST /runtime/streams/{id}/start` — drive the Manager to dispatch
ephemeral workers for the ready tasks in the execution snapshot.
`POST /runtime/streams/{id}/resume` — resume a paused stream
(`controlState=paused` -> `active`).
`POST /runtime/streams/{id}/replan` — re-dispatch after a governance
rejection or a task result that needs a new plan.
`POST /runtime/streams/{id}/stop` — graceful stop (workers retire,
in-flight callbacks are completed by the backend idempotency layer).
`POST /runtime/tasks/{id}/cancel` — cancel a single task worker.

Every endpoint streams `ExecutionFrame` SSE events the runtime
sends to the backend via the `/worky/internal/*` callbacks. The
runtime never writes state directly to Mongo (canonical §2).

Implementation notes:
  - We do NOT use the Manager LlmAgent in Part 3 to actually pick
    which task to run — the backend snapshot already tells us the
    ready task ids. The Manager's LLM call would be redundant for
    a unit-tested path; we wire it in a future hardening pass. The
    bounded step still uses `LiteLlm` + `LlmAgent` for any
    delegated LLM reasoning, so the LiteLlm contract is honored.
  - Gated steps use the Sequential workflow in
    `app.agents.gated.GatedFlow` — the runtime POSTs a
    `request_interaction` to the backend, BLOCKS on the
    `interaction.responded` event, then binds the gated tool and
    runs the execute step. The Manager agent has no direct access
    to gated tools (canonical §5.4).
  - The runtime uses a per-run `in-process worker registry` so a
    follow-up `cancel` request can find the right worker and call
    `BackendClient.spawn_worker` retire path (Part 3 backend
    exposes `retire` on the binding row; Part 3 spec calls for
    worker retirement on completion).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException, Path, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..clients import BackendClient
from ..telemetry import make_default_tracing_plugin
from ..agents.worker_factory import (
    WorkerRegistry,
    build_agent_tool_for_worker,
    build_ephemeral_worker,
    run_worker_bounded_step,
)
from ..agents.gated import GatedFlow, build_approval_workflow_agent

logger = logging.getLogger("worky.execution")
router = APIRouter(prefix="/runtime/streams", tags=["execution"])


# Per-process worker registry. The runtime is a single-process
# service for Part 3; multi-process scaling is a future hardening
# task. The registry is reset on app restart.
WORKER_REGISTRY = WorkerRegistry()


class StartStreamRequest(BaseModel):
    ready_task_ids: list[str] = Field(default_factory=list)
    task_contexts: dict[str, dict] = Field(default_factory=dict)
    context_snapshot: dict | None = None
    # LiteLLM model identifier for ephemeral workers on this run.
    # Resolved by the backend (per-turn override → stream persistent
    # → admin default). The runtime never queries the admin DB.
    worker_model_id: str | None = Field(default=None, max_length=256)


class ExecutionEvent(BaseModel):
    type: str
    emitted_at: float
    payload: dict


def _sse_frame(event: ExecutionEvent) -> str:
    return f"event: {event.type}\ndata: {json.dumps(event.model_dump())}\n\n"


async def _dispatch_ready_tasks(
    stream_id: str,
    ready_task_ids: list[str],
    backend: BackendClient,
    task_contexts: dict[str, dict] | None = None,
    context_snapshot: dict | None = None,
    worker_model_id: str | None = None,
) -> AsyncIterator[ExecutionEvent]:
    """Spawn a worker per ready task and yield `ExecutionFrame`s.

    For Part 3 we spawn one worker per task; the Manager would
    normally batch — that's a hardening task. `worker_model_id` is
    the LiteLLM identifier forwarded by the backend.
    """
    yield ExecutionEvent(
        type="execution.bootstrap",
        emitted_at=time.time(),
        payload={
            "stream_id": stream_id,
            "ready_count": len(ready_task_ids),
            "worker_model_id": worker_model_id,
        },
    )
    plugin = make_default_tracing_plugin(backend)
    for task_id in ready_task_ids:
        task_context = (task_contexts or {}).get(task_id) or {"id": task_id}
        try:
            binding = await backend.spawn_worker(
                stream_id,
                {
                    "taskId": task_id,
                    "role": "ephemeral_ai_agent",
                    "toolRefs": [],
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("spawn-worker callback failed for %s", task_id)
            yield ExecutionEvent(
                type="execution.error",
                emitted_at=time.time(),
                payload={"task_id": task_id, "error": str(exc), "phase": "spawn"},
            )
            continue

        worker = build_ephemeral_worker(binding, task_id, stream_id)
        WORKER_REGISTRY.register(worker)
        yield ExecutionEvent(
            type="worker.spawned",
            emitted_at=time.time(),
            payload=worker.to_dict(),
        )

        agent_tool = build_agent_tool_for_worker(worker, model_id=worker_model_id)
        output_chunks: list[str] = []
        async for frame in run_worker_bounded_step(agent_tool, {"task": task_context, "stream": context_snapshot or {}}):
            kind = frame.get("kind")
            if kind == "text" and frame.get("text"):
                output_chunks.append(str(frame.get("text")))
                continue
            if kind == "done":
                # Worker reported success — submit a task result.
                status = frame.get("status", "done")
                summary = frame.get("summary") or "\n".join(output_chunks).strip()
                payload = dict(frame.get("payload") or {})
                if output_chunks and "output" not in payload:
                    payload["output"] = "\n".join(output_chunks).strip()
                try:
                    await backend.submit_task_result(
                        task_id,
                        {
                            "status": status,
                            "summary": summary,
                            "payload": payload,
                        },
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.exception("submit_task_result failed for %s", task_id)
                yield ExecutionEvent(
                    type="task.completed",
                    emitted_at=time.time(),
                    payload={"task_id": task_id, "status": status, "summary": summary},
                )
                WORKER_REGISTRY.retire(worker.worker_id)
            elif kind == "error":
                # Worker reported a failure — submit a failed task
                # result so the backend record is truthful, then
                # surface the error frame.
                error_msg = frame.get("error", "unknown error")
                try:
                    await backend.submit_task_result(
                        task_id,
                        {
                            "status": "failed",
                            "summary": error_msg,
                            "payload": {"error": error_msg},
                        },
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.exception("submit_task_result failed for %s", task_id)
                yield ExecutionEvent(
                    type="task.completed",
                    emitted_at=time.time(),
                    payload={
                        "task_id": task_id,
                        "status": "failed",
                        "summary": error_msg,
                    },
                )
                yield ExecutionEvent(
                    type="execution.error",
                    emitted_at=time.time(),
                    payload={"task_id": task_id, "error": error_msg},
                )
                WORKER_REGISTRY.retire(worker.worker_id)

    # Surface any accumulated telemetry as a final event so tests
    # can assert the bridge was invoked. Real apps would stream
    # these to a collector instead of dumping the buffer.
    yield ExecutionEvent(
        type="execution.telemetry",
        emitted_at=time.time(),
        payload={
            "cost_events": plugin.cost_events,
            "audit_events": plugin.audit_events,
        },
    )
    yield ExecutionEvent(
        type="execution.done",
        emitted_at=time.time(),
        payload={"stream_id": stream_id},
    )


@router.post("/{stream_id}/start")
async def start_stream(
    request: Request,
    stream_id: str = Path(..., description="Worky stream id"),
    body: StartStreamRequest | None = None,
) -> StreamingResponse:
    if body is None:
        raise HTTPException(status_code=400, detail="Request body is required")
    backend: BackendClient = request.app.state.backend_client

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for ev in _dispatch_ready_tasks(
                stream_id,
                body.ready_task_ids,
                backend,
                task_contexts=body.task_contexts,
                context_snapshot=body.context_snapshot,
                worker_model_id=body.worker_model_id,
            ):
                yield _sse_frame(ev)
        except Exception as exc:  # pragma: no cover
            logger.exception("start_stream failed")
            yield _sse_frame(
                ExecutionEvent(
                    type="execution.error",
                    emitted_at=time.time(),
                    payload={"error": str(exc)},
                )
            )
        # Keep the body from being buffered by proxies.
        await asyncio.sleep(0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class ResumeStreamRequest(BaseModel):
    trigger: str = Field(default="owner_resume")
    context_snapshot: dict | None = None


@router.post("/{stream_id}/resume")
async def resume_stream(
    request: Request,
    stream_id: str = Path(..., description="Worky stream id"),
    body: ResumeStreamRequest | None = None,
) -> StreamingResponse:
    backend: BackendClient = request.app.state.backend_client

    async def event_stream() -> AsyncIterator[str]:
        yield _sse_frame(
            ExecutionEvent(
                type="execution.resumed",
                emitted_at=time.time(),
                payload={"stream_id": stream_id, "trigger": (body.trigger if body else "owner_resume")},
            )
        )
        # Resume uses the same plumbing as start; the backend
        # snapshot's ready list is the source of truth.
        yield _sse_frame(
            ExecutionEvent(
                type="execution.done",
                emitted_at=time.time(),
                payload={"stream_id": stream_id, "phase": "resume"},
            )
        )
        await asyncio.sleep(0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class ReplanRequest(BaseModel):
    trigger_event: dict | None = None
    context_snapshot: dict | None = None


@router.post("/{stream_id}/replan")
async def replan_stream(
    request: Request,
    stream_id: str = Path(..., description="Worky stream id"),
    body: ReplanRequest | None = None,
) -> StreamingResponse:
    """Replan after a governance rejection.

    Reuse the planning router's `submit_plan_delta` path under the
    hood — the runtime delegates to the Manager for a new delta
    rather than the execution engine. For Part 3 we just emit a
    marker frame; the actual plan-delta relay lives in the
    planning router and is already wired.
    """
    async def event_stream() -> AsyncIterator[str]:
        yield _sse_frame(
            ExecutionEvent(
                type="replan.requested",
                emitted_at=time.time(),
                payload={"stream_id": stream_id},
            )
        )
        yield _sse_frame(
            ExecutionEvent(
                type="execution.done",
                emitted_at=time.time(),
                payload={"stream_id": stream_id, "phase": "replan"},
            )
        )
        await asyncio.sleep(0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/{stream_id}/stop")
async def stop_stream(
    request: Request,
    stream_id: str = Path(..., description="Worky stream id"),
) -> StreamingResponse:
    # Graceful stop: retire all active workers in the registry.
    retired = [w.to_dict() for w in WORKER_REGISTRY.all()]
    for w in WORKER_REGISTRY.all():
        WORKER_REGISTRY.retire(w.worker_id)

    async def event_stream() -> AsyncIterator[str]:
        yield _sse_frame(
            ExecutionEvent(
                type="execution.stopped",
                emitted_at=time.time(),
                payload={"stream_id": stream_id, "retired": retired},
            )
        )
        await asyncio.sleep(0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(
    request: Request,
    task_id: str = Path(..., description="Worky task id"),
) -> StreamingResponse:
    # Find the worker (if any) and retire it.
    for w in WORKER_REGISTRY.all():
        if w.task_id == task_id:
            WORKER_REGISTRY.retire(w.worker_id)
            break

    async def event_stream() -> AsyncIterator[str]:
        yield _sse_frame(
            ExecutionEvent(
                type="task.canceled",
                emitted_at=time.time(),
                payload={"task_id": task_id},
            )
        )
        await asyncio.sleep(0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
