import json
import os
import re
from collections.abc import Callable
from typing import Any, Literal
from urllib.parse import quote, urlencode

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse

from auth import TrustedIdentityMiddleware, require_acting_user_id, require_actor_context
from clients.yellowstorm_playbook_client import PlaybookBackendError, YellowStormPlaybookClient
from config import Settings
from contracts import PlaybookMcpResultV1, failure_result, success_result


INSTRUCTIONS = """Find, design, change, check, run and diagnose YellowStorm Playbooks for the user.

Talk about Playbooks, tasks, executions, workspaces and files by their names only: never show ids.
Any playbook_id parameter also accepts the Playbook's exact name, and any task_id parameter the task's exact name.

Design: start_playbook_generation for a new Playbook, modify_playbook for a change. They may return
clarification questions; ask them, then call the same tool again with the continuation_id and the answers.
A new Playbook is created by start_playbook_generation only: never call start_playbook_construction for it.
Changes are applied in the Playbook canvas through the returned handoff, with Undo there.

Sources are the user's decision. Questions with a resourceSelector ask for a source or a destination: the
conversation shows a sources card where the user picks from a searchable list of all their workspaces and files, or
skips the question (the Playbook then asks for it when it runs). Never search workspaces or documents and never
ask for names or ids for these questions; ask only the other questions. When the user says they chose or
skipped, continue with the continuation_id and the other answers: their picks are joined automatically. If the
result says a source is still missing, ask the user to choose it in the sources card or to skip it.

Runs are the user's decision too: start_playbook_execution, reexecute_playbook_execution and
run_playbook_from_step only when the user asks in this conversation, or confirms after you named the Playbook
and its inputs. cancel_playbook_execution stops a running execution when the user asks. Ask before
delete_playbook_execution. Never answer runtime human-in-the-loop requests: send the user to the canvas."""

settings = Settings.from_env()
mcp = FastMCP("Playbook MCP", instructions=INSTRUCTIONS)
# MCP hints for clients that ask before acting: reads change nothing; these remove, stop or undo.
READ_ONLY = {"readOnlyHint": True}
DESTRUCTIVE = {"readOnlyHint": False, "destructiveHint": True}
OBJECT_ID = re.compile(r"^[0-9a-fA-F]{24}$")
_client: YellowStormPlaybookClient | None = None


def backend() -> YellowStormPlaybookClient:
    global _client
    if _client is None:
        _client = YellowStormPlaybookClient(
            settings.backend_url,
            settings.internal_token,
            settings.timeout_seconds,
            settings.max_response_bytes,
        )
    return _client


async def call(
    operation,
    transform: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> PlaybookMcpResultV1:
    correlation_id = require_actor_context().correlation_id
    try:
        result = await operation
        data = result if isinstance(result, dict) else {"result": result}
        if transform is not None:
            data = transform(data)
        return success_result(data, correlation_id)
    except PlaybookBackendError as exc:
        return failure_result(
            exc.code,
            str(exc),
            exc.status_code,
            correlation_id,
            exc.details,
        )


async def mascot_call(operation) -> PlaybookMcpResultV1:
    return await call(operation)


def path_id(value: str) -> str:
    return quote(value, safe="")


async def playbook_ref(value: str) -> str:
    """The Playbook id for an id or an exact Playbook name; anything else is passed on unchanged."""
    value = value.strip()
    if OBJECT_ID.match(value):
        return value
    params = urlencode({"query": value[:200], "limit": settings.search_limit_max})
    try:
        found = await backend().get(f"/api/v1/internal/playbook-assistant/playbooks?{params}", require_acting_user_id())
    except PlaybookBackendError:
        return value
    items = found.get("items") if isinstance(found, dict) else None
    exact = [
        item for item in items or []
        if isinstance(item, dict) and str(item.get("name", "")).strip().lower() == value.lower()
    ]
    if len(exact) == 1 and isinstance(exact[0].get("playbookId"), str):
        return exact[0]["playbookId"]
    return value


async def task_ref(playbook_id: str, value: str | None) -> str | None:
    """The task id for a task id or an exact task name of the Playbook; anything else is passed on unchanged."""
    if not value or not value.strip():
        return value
    value = value.strip()
    try:
        summary = await backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/summary", require_acting_user_id())
    except PlaybookBackendError:
        return value
    workflow = summary.get("workflow") if isinstance(summary, dict) else None
    tasks = [task for task in (workflow or {}).get("tasks") or [] if isinstance(task, dict) and isinstance(task.get("id"), str)]
    if any(task["id"] == value for task in tasks):
        return value
    named = [task for task in tasks if str(task.get("label") or "").strip().lower() == value.lower()]
    return named[0]["id"] if len(named) == 1 else value


async def execution_playbook_id(execution_id: str) -> str | None:
    try:
        execution = await backend().get(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}", require_acting_user_id())
    except PlaybookBackendError:
        return None
    if not isinstance(execution, dict):
        return None
    playbook_id = execution.get("flowId") or execution.get("playbookId")
    return playbook_id if isinstance(playbook_id, str) else None


def coerce_answers(value: list[dict[str, Any]] | str | None) -> list[dict[str, Any]]:
    # Models routinely serialize list arguments as a JSON string; accept it at the tool boundary.
    if value is None:
        return []
    if isinstance(value, list):
        return value
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("answers must be a list of objects or a JSON-encoded list") from exc
    if not isinstance(parsed, list) or not all(isinstance(item, dict) for item in parsed):
        raise ValueError("answers must be a JSON-encoded list of objects")
    return parsed


@mcp.custom_route("/health/live", methods=["GET"])
async def health_live(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


@mcp.custom_route("/health/ready", methods=["GET"])
async def health_ready(_request: Request) -> JSONResponse:
    try:
        settings.validate()
    except ValueError:
        return JSONResponse({"status": "not_ready"}, status_code=503)
    return JSONResponse({"status": "ready"})


@mcp.custom_route("/construction-events/{playbook_id}/{operation_id}", methods=["GET"])
async def construction_events(request: Request) -> StreamingResponse:
    playbook_id = path_id(request.path_params["playbook_id"])
    operation_id = path_id(request.path_params["operation_id"])
    cursor = request.headers.get("last-event-id") or request.query_params.get("after") or "0"
    last_event_id = int(cursor) if cursor.isdigit() else 0
    path = f"/api/v1/internal/playbook-assistant/playbooks/{playbook_id}/constructions/{operation_id}/events?after={last_event_id}"
    return StreamingResponse(
        backend().stream(path, require_acting_user_id(), last_event_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@mcp.tool(annotations=READ_ONLY)
async def search_playbooks(
    query: str | None = None,
    workspace_id: str | None = None,
    limit: int = 10,
) -> PlaybookMcpResultV1:
    """Search permission-filtered Playbooks by name and return semantic UI targets."""
    normalized_query = query.strip()[:200] if query else None
    bounded_limit = min(max(limit, 1), settings.search_limit_max)
    params = urlencode({
        **({"query": normalized_query} if normalized_query else {}),
        **({"workspaceId": workspace_id.strip()[:200]} if workspace_id and workspace_id.strip() else {}),
        "limit": bounded_limit,
    })
    return await mascot_call(backend().get(
        f"/api/v1/internal/playbook-assistant/playbooks?{params}",
        require_acting_user_id(),
    ))


@mcp.tool(annotations=READ_ONLY)
async def open_playbook_context(playbook_id: str, selected_task_id: str | None = None, execution_id: str | None = None) -> PlaybookMcpResultV1:
    """Open permission-filtered canonical Playbook context. Runtime HITL is status-only."""
    playbook_id = await playbook_ref(playbook_id)
    selected_task_id = await task_ref(playbook_id, selected_task_id)
    payload = {"selectedTaskId": selected_task_id, "executionId": execution_id}
    def add_hitl_status(result: dict[str, Any]) -> dict[str, Any]:
        execution = result.get("execution")
        if isinstance(execution, dict) and execution.get("waitingForHumanInput") is True:
            result["assistantStatus"] = "runtime_hitl_required"
            result["message"] = "Continue in the existing Playbook runtime HITL panel."
        return result

    return await call(
        backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/context", require_acting_user_id(), payload),
        add_hitl_status,
    )


@mcp.tool(annotations=READ_ONLY)
async def get_playbook_summary(playbook_id: str) -> PlaybookMcpResultV1:
    """Get a canonical workflow summary and its current definition revision."""
    playbook_id = await playbook_ref(playbook_id)
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/summary", require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def get_task_details(playbook_id: str, task_id: str) -> PlaybookMcpResultV1:
    """Get the complete design-time definition of an existing task."""
    playbook_id = await playbook_ref(playbook_id)
    task_id = await task_ref(playbook_id, task_id) or task_id
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/tasks/{path_id(task_id)}", require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def get_task_dependencies(playbook_id: str, task_id: str) -> PlaybookMcpResultV1:
    """Explain incoming/outgoing control dependencies and data bindings for a task."""
    playbook_id = await playbook_ref(playbook_id)
    task_id = await task_ref(playbook_id, task_id) or task_id
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/tasks/{path_id(task_id)}/dependencies", require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def validate_playbook(playbook_id: str) -> PlaybookMcpResultV1:
    """Run deterministic validation against the canonical Playbook definition."""
    playbook_id = await playbook_ref(playbook_id)
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/validation", require_acting_user_id()))


@mcp.tool()
async def assess_playbook_request(request_id: str) -> PlaybookMcpResultV1:
    """Assess a trusted assistant request and return typed clarification or construction readiness."""
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/requests/{path_id(request_id)}/assessment",
        require_acting_user_id(),
        {},
    ))


def canvas_target(result: dict[str, Any], playbook_id: str, operation_id: str) -> dict[str, Any]:
    """The button that opens the canvas on an operation, named after the Playbook when the backend gave its name."""
    params: dict[str, Any] = {"playbookId": playbook_id, "operationId": operation_id}
    name = result.get("playbookName")
    if isinstance(name, str) and name.strip():
        params["playbookName"] = name.strip()
    return {"surface": "playbook.editor.assistant", "params": params}


@mcp.tool()
async def continue_playbook_clarification(
    continuation_id: str,
    answers: list[dict[str, Any]] | str,
    skip_clarification: bool = False,
) -> PlaybookMcpResultV1:
    """Submit typed answers to the active trusted clarification continuation.

    Prefer the tool that asked the questions: start_playbook_generation (new Playbook) or modify_playbook
    (existing Playbook), with continuation_id and answers. For a new Playbook this tool also starts the draft
    once the answers are complete and returns the canvas handoff; do not call start_playbook_construction after it.
    """
    def add_canvas_handoff(result: dict[str, Any]) -> dict[str, Any]:
        operation_id = result.get("operationId")
        playbook_id = result.get("playbookId")
        if isinstance(operation_id, str) and isinstance(playbook_id, str):
            result["uiTarget"] = canvas_target(result, playbook_id, operation_id)
            result["eventStreamOwner"] = "playbook_canvas"
            result["publicationStatus"] = "draft"
        return result

    return await call(
        backend().post(
            f"/api/v1/internal/playbook-assistant/clarifications/{path_id(continuation_id)}",
            require_acting_user_id(),
            {"answers": coerce_answers(answers), "skip": skip_clarification},
        ),
        add_canvas_handoff,
    )


@mcp.tool()
async def start_playbook_construction(
    request_id: str,
    context_id: str | None = None,
) -> PlaybookMcpResultV1:
    """Start incremental workflow construction. The Playbook canvas applies the operation automatically once the returned handoff is opened."""
    payload = {"contextId": context_id}
    def add_canvas_handoff(result: dict[str, Any]) -> dict[str, Any]:
        operation_id = result.get("operationId")
        playbook_id = result.get("playbookId")
        if isinstance(operation_id, str) and isinstance(playbook_id, str):
            result["uiTarget"] = canvas_target(result, playbook_id, operation_id)
            result["eventStreamOwner"] = "playbook_canvas"
        return result

    return await call(
        backend().post(f"/api/v1/internal/playbook-assistant/requests/{path_id(request_id)}/constructions", require_acting_user_id(), payload),
        add_canvas_handoff,
    )


@mcp.tool()
async def start_playbook_generation(
    name: str | None = None,
    continuation_id: str | None = None,
    answers: list[dict[str, Any]] | str | None = None,
    skip_clarification: bool = False,
) -> PlaybookMcpResultV1:
    """Assess and start one operation-owned draft from the trusted current turn.

    The first call may return typed clarification questions. Follow up with the returned continuation_id
    and answers. Set skip_clarification=true only when the user explicitly skips remaining questions.
    Questions with a resourceSelector are answered by the user in the sources card (a searchable list of
    their workspaces and files); leave them out of answers, their picks are joined automatically.
    Draft creation starts only after the request is ready.
    """
    def add_canvas_handoff(result: dict[str, Any]) -> dict[str, Any]:
        operation_id = result.get("operationId")
        playbook_id = result.get("playbookId")
        if isinstance(operation_id, str) and isinstance(playbook_id, str):
            result["uiTarget"] = canvas_target(result, playbook_id, operation_id)
            result["eventStreamOwner"] = "playbook_canvas"
            result["publicationStatus"] = "draft"
        return result

    return await call(
        backend().post(
            "/api/v1/internal/playbook-assistant/generation",
            require_acting_user_id(),
            {
                "name": name,
                "continuationId": continuation_id,
                "answers": coerce_answers(answers),
                "skip": skip_clarification,
            },
        ),
        add_canvas_handoff,
    )


@mcp.tool()
async def modify_playbook(
    playbook_id: str,
    continuation_id: str | None = None,
    answers: list[dict[str, Any]] | str | None = None,
    skip_clarification: bool = False,
) -> PlaybookMcpResultV1:
    """Modify an existing Playbook from the current trusted conversation turn.

    First call (playbook_id only): assesses the user request and returns typed clarification questions
    (status needs_clarification with a continuation_id) or a preview construction (status ready).
    Follow-up call: pass continuation_id plus answers to submit typed clarifications. Each answer MUST be
    an object {"questionId": string, "choice": string} or {"questionId": string, "text": string} using the
    question ids and choices returned by the assessment. Questions with a resourceSelector are answered by
    the user in the sources card; leave them out of answers, their picks are joined automatically.
    playbook_id also accepts the Playbook's exact name. When the user asks to skip the remaining
    questions, pass skip_clarification=true together with any answers already collected; the modification
    then starts immediately using sensible defaults for the skipped questions. Never applies changes
    directly; committed changes happen only through the returned Playbook canvas operation.
    """
    playbook_id = await playbook_ref(playbook_id)
    payload = {"continuationId": continuation_id, "answers": coerce_answers(answers), "skip": skip_clarification}
    def add_canvas_handoff(result: dict[str, Any]) -> dict[str, Any]:
        operation = result.get("operation")
        if isinstance(operation, dict) and isinstance(operation.get("operationId"), str):
            result["uiTarget"] = canvas_target(result, operation.get("playbookId") or playbook_id, operation["operationId"])
            result["eventStreamOwner"] = "playbook_canvas"
        return result

    return await call(
        backend().post(
            f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/current-turn/modification",
            require_acting_user_id(),
            payload,
        ),
        add_canvas_handoff,
    )


@mcp.tool(annotations=READ_ONLY)
async def get_playbook_construction(playbook_id: str, operation_id: str) -> PlaybookMcpResultV1:
    """Get current construction status and the last emitted sequence."""
    playbook_id = await playbook_ref(playbook_id)
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/constructions/{path_id(operation_id)}", require_acting_user_id()))


@mcp.tool(annotations=DESTRUCTIVE)
async def cancel_playbook_construction(playbook_id: str, operation_id: str, reason: str | None = None) -> PlaybookMcpResultV1:
    """Cancel a construction operation. Any frontend preview must be discarded."""
    playbook_id = await playbook_ref(playbook_id)
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/constructions/{path_id(operation_id)}/cancel", require_acting_user_id(), {"reason": reason}))


@mcp.tool(annotations=READ_ONLY)
async def analyze_task_optimization(
    playbook_id: str,
    task_id: str,
    execution_id: str | None = None,
    dimensions: list[Literal["clarity", "agent", "model", "tools", "inputs", "outputs", "bindings", "cost", "latency", "determinism"]] | None = None,
) -> PlaybookMcpResultV1:
    """Analyze a selected task using canonical design data and optional execution evidence. No mutation occurs."""
    playbook_id = await playbook_ref(playbook_id)
    task_id = await task_ref(playbook_id, task_id) or task_id
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/tasks/{path_id(task_id)}/optimization",
        require_acting_user_id(),
        {"executionId": execution_id, "dimensions": dimensions},
    ))


@mcp.tool()
async def start_advisor_remediation_construction(
    playbook_id: str,
    execution_id: str,
    mode: Literal["optimize-step", "update-current", "generate-new"],
    items: list[dict[str, str]],
    expected_definition_revision: int,
    selected_task_id: str | None = None,
) -> PlaybookMcpResultV1:
    """Start an incremental Advisor/Judge remediation preview. It does not apply or create a Playbook."""
    playbook_id = await playbook_ref(playbook_id)
    selected_task_id = await task_ref(playbook_id, selected_task_id)
    payload = {
        "executionId": execution_id,
        "selectedTaskId": selected_task_id,
        "mode": mode,
        "items": items,
        "expectedDefinitionRevision": expected_definition_revision,
    }
    def add_canvas_handoff(result: dict[str, Any]) -> dict[str, Any]:
        operation_id = result.get("operationId")
        if isinstance(operation_id, str):
            result["uiTarget"] = canvas_target(result, playbook_id, operation_id)
            result["eventStreamOwner"] = "playbook_canvas"
        return result

    return await call(
        backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/advisor-remediation-constructions", require_acting_user_id(), payload),
        add_canvas_handoff,
    )


@mcp.tool(annotations=READ_ONLY)
async def analyze_workflow_optimization(
    playbook_id: str,
    execution_id: str | None = None,
    dimensions: list[Literal["clarity", "agent", "model", "tools", "inputs", "outputs", "bindings", "cost", "latency", "determinism"]] | None = None,
) -> PlaybookMcpResultV1:
    """Analyze the complete workflow and optional execution evidence without mutation."""
    playbook_id = await playbook_ref(playbook_id)
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/workflow-optimization",
        require_acting_user_id(),
        {"executionId": execution_id, "dimensions": dimensions},
    ))


@mcp.tool()
async def start_workflow_optimization(
    request_id: str,
    context_id: str | None = None,
) -> PlaybookMcpResultV1:
    """Start a durable canvas-owned workflow optimization construction."""
    return await start_playbook_construction(request_id, context_id)


@mcp.tool()
async def create_playbook(name: str, description: str | None = None, workspace_ids: list[str] | None = None) -> PlaybookMcpResultV1:
    """Create an empty canonical Playbook owned by the acting user."""
    return await call(backend().post(
        "/api/v1/internal/playbook-assistant/playbooks",
        require_acting_user_id(),
        {"name": name, "description": description, "workspaces": workspace_ids or []},
    ))


@mcp.tool()
async def clone_playbook(playbook_id: str) -> PlaybookMcpResultV1:
    """Clone an accessible Playbook for the acting user."""
    playbook_id = await playbook_ref(playbook_id)
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/clone", require_acting_user_id(), {}))


@mcp.tool(annotations=DESTRUCTIVE)
async def revert_playbook_construction(playbook_id: str, operation_id: str) -> PlaybookMcpResultV1:
    """Revert one committed assistant operation if no later Playbook revision exists."""
    playbook_id = await playbook_ref(playbook_id)
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/constructions/{path_id(operation_id)}/revert",
        require_acting_user_id(),
        {},
    ))


@mcp.tool()
async def start_playbook_execution(playbook_id: str, idempotency_key: str | None = None, input_context: dict[str, Any] | None = None, single_step_task_id: str | None = None) -> PlaybookMcpResultV1:
    """Start a Playbook execution. Runtime HITL responses remain canvas-owned."""
    playbook_id = await playbook_ref(playbook_id)
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/executions",
        require_acting_user_id(),
        {"inputContext": input_context, "singleStepTaskId": await task_ref(playbook_id, single_step_task_id)},
        idempotency_key,
    ))


@mcp.tool(annotations=READ_ONLY)
async def list_playbook_executions(playbook_id: str, page: int = 1, limit: int = 10) -> PlaybookMcpResultV1:
    """List execution summaries for an accessible Playbook."""
    playbook_id = await playbook_ref(playbook_id)
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/executions?page={page}&limit={limit}", require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def list_recent_executions(
    status: str | None = None,
    limit: int = 10,
) -> PlaybookMcpResultV1:
    """List recent permission-filtered executions across accessible Playbooks."""
    params = urlencode({
        **({"status": status} if status else {}),
        "limit": min(max(limit, 1), settings.search_limit_max),
    })
    return await mascot_call(backend().get(
        f"/api/v1/internal/playbook-assistant/executions?{params}",
        require_acting_user_id(),
    ))


@mcp.tool(annotations=READ_ONLY)
async def get_playbook_execution(execution_id: str) -> PlaybookMcpResultV1:
    """Get execution status and results. Pending HITL is status-only."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}", require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def get_execution_diagnostics(execution_id: str) -> PlaybookMcpResultV1:
    """Get deterministic redacted diagnostics without retrying or mutating an execution."""
    return await mascot_call(backend().get(
        f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/diagnostics",
        require_acting_user_id(),
    ))


@mcp.tool(annotations=DESTRUCTIVE)
async def cancel_playbook_execution(execution_id: str) -> PlaybookMcpResultV1:
    """Cancel a running Playbook execution."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/cancel", require_acting_user_id(), {}))


@mcp.tool(annotations=READ_ONLY)
async def trace_replay_playbook_execution(execution_id: str) -> PlaybookMcpResultV1:
    """Trace replay an execution from recorded events without runtime mutation."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/trace-replay", require_acting_user_id(), {}))


@mcp.tool()
async def reexecute_playbook_execution(execution_id: str) -> PlaybookMcpResultV1:
    """Start a new execution using the source execution inputs."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/re-execute", require_acting_user_id(), {}))


@mcp.tool()
async def run_playbook_from_step(execution_id: str, task_id: str, iteration: int | None = None) -> PlaybookMcpResultV1:
    """Start a new execution downstream of a completed step; this never resumes HITL. task_id also accepts the task's exact name."""
    playbook_id = await execution_playbook_id(execution_id)
    if playbook_id:
        task_id = await task_ref(playbook_id, task_id) or task_id
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/run-from-step",
        require_acting_user_id(),
        {"taskId": task_id, "iteration": iteration},
    ))


@mcp.tool(annotations=DESTRUCTIVE)
async def delete_playbook_execution(execution_id: str) -> PlaybookMcpResultV1:
    """Delete one accessible execution and its associated records."""
    return await call(backend().delete(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}", require_acting_user_id()))


if __name__ == "__main__":
    settings.validate()
    os.environ.setdefault("HOST", "0.0.0.0")
    middleware = [Middleware(
        TrustedIdentityMiddleware,
        ingress_token=settings.ingress_token,
    )]
    mcp.run(transport="streamable-http", host="0.0.0.0", port=settings.port, middleware=middleware)
