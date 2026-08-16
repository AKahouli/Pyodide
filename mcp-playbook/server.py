import os
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


settings = Settings.from_env()
mcp = FastMCP("Playbook MCP")
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


@mcp.tool()
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


@mcp.tool()
async def open_playbook_context(playbook_id: str, selected_task_id: str | None = None, execution_id: str | None = None) -> PlaybookMcpResultV1:
    """Open permission-filtered canonical Playbook context. Runtime HITL is status-only."""
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


@mcp.tool()
async def get_playbook_summary(playbook_id: str) -> PlaybookMcpResultV1:
    """Get a canonical workflow summary and its current definition revision."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/summary", require_acting_user_id()))


@mcp.tool()
async def get_task_details(playbook_id: str, task_id: str) -> PlaybookMcpResultV1:
    """Get the complete design-time definition of an existing task."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/tasks/{path_id(task_id)}", require_acting_user_id()))


@mcp.tool()
async def get_task_dependencies(playbook_id: str, task_id: str) -> PlaybookMcpResultV1:
    """Explain incoming/outgoing control dependencies and data bindings for a task."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/tasks/{path_id(task_id)}/dependencies", require_acting_user_id()))


@mcp.tool()
async def validate_playbook(playbook_id: str) -> PlaybookMcpResultV1:
    """Run deterministic validation against the canonical Playbook definition."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/validation", require_acting_user_id()))


@mcp.tool()
async def assess_playbook_request(request_id: str) -> PlaybookMcpResultV1:
    """Assess a trusted assistant request and return typed clarification or construction readiness."""
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/requests/{path_id(request_id)}/assessment",
        require_acting_user_id(),
        {},
    ))


@mcp.tool()
async def continue_playbook_clarification(
    continuation_id: str,
    answers: list[dict[str, Any]],
) -> PlaybookMcpResultV1:
    """Submit typed answers to the active trusted clarification continuation."""
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/clarifications/{path_id(continuation_id)}",
        require_acting_user_id(),
        {"answers": answers},
    ))


@mcp.tool()
async def start_playbook_construction(
    request_id: str,
    context_id: str | None = None,
) -> PlaybookMcpResultV1:
    """Start incremental workflow construction. This returns a preview operation and never applies it."""
    payload = {"contextId": context_id}
    def add_canvas_handoff(result: dict[str, Any]) -> dict[str, Any]:
        operation_id = result.get("operationId")
        playbook_id = result.get("playbookId")
        if isinstance(operation_id, str) and isinstance(playbook_id, str):
            result["uiTarget"] = {
                "surface": "playbook.editor.assistant",
                "params": {"playbookId": playbook_id, "operationId": operation_id},
            }
            result["eventStreamOwner"] = "playbook_canvas"
        return result

    return await call(
        backend().post(f"/api/v1/internal/playbook-assistant/requests/{path_id(request_id)}/constructions", require_acting_user_id(), payload),
        add_canvas_handoff,
    )


@mcp.tool()
async def start_playbook_generation(
    name: str | None = None,
) -> PlaybookMcpResultV1:
    """Start one idempotent operation-owned draft and hand it off to the Playbook canvas."""
    def add_canvas_handoff(result: dict[str, Any]) -> dict[str, Any]:
        operation_id = result.get("operationId")
        playbook_id = result.get("playbookId")
        if isinstance(operation_id, str) and isinstance(playbook_id, str):
            result["uiTarget"] = {
                "surface": "playbook.editor.assistant",
                "params": {"playbookId": playbook_id, "operationId": operation_id},
            }
            result["eventStreamOwner"] = "playbook_canvas"
            result["publicationStatus"] = "draft"
        return result

    return await call(
        backend().post(
            "/api/v1/internal/playbook-assistant/generation",
            require_acting_user_id(),
            {"name": name},
        ),
        add_canvas_handoff,
    )


@mcp.tool()
async def get_playbook_construction(playbook_id: str, operation_id: str) -> PlaybookMcpResultV1:
    """Get current construction status and the last emitted sequence."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/constructions/{path_id(operation_id)}", require_acting_user_id()))


@mcp.tool()
async def cancel_playbook_construction(playbook_id: str, operation_id: str, reason: str | None = None) -> PlaybookMcpResultV1:
    """Cancel a construction operation. Any frontend preview must be discarded."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/constructions/{path_id(operation_id)}/cancel", require_acting_user_id(), {"reason": reason}))


@mcp.tool()
async def analyze_task_optimization(
    playbook_id: str,
    task_id: str,
    execution_id: str | None = None,
    dimensions: list[Literal["clarity", "agent", "model", "tools", "inputs", "outputs", "bindings", "cost", "latency", "determinism"]] | None = None,
) -> PlaybookMcpResultV1:
    """Analyze a selected task using canonical design data and optional execution evidence. No mutation occurs."""
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
            result["uiTarget"] = {
                "surface": "playbook.editor.assistant",
                "params": {
                    "playbookId": playbook_id,
                    "operationId": operation_id,
                    "preview": "advisor",
                },
            }
            result["eventStreamOwner"] = "playbook_canvas"
        return result

    return await call(
        backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/advisor-remediation-constructions", require_acting_user_id(), payload),
        add_canvas_handoff,
    )


@mcp.tool()
async def analyze_workflow_optimization(
    playbook_id: str,
    execution_id: str | None = None,
    dimensions: list[Literal["clarity", "agent", "model", "tools", "inputs", "outputs", "bindings", "cost", "latency", "determinism"]] | None = None,
) -> PlaybookMcpResultV1:
    """Analyze the complete workflow and optional execution evidence without mutation."""
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
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/clone", require_acting_user_id(), {}))


@mcp.tool()
async def revert_playbook_construction(playbook_id: str, operation_id: str) -> PlaybookMcpResultV1:
    """Revert one committed assistant operation if no later Playbook revision exists."""
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/constructions/{path_id(operation_id)}/revert",
        require_acting_user_id(),
        {},
    ))


@mcp.tool()
async def start_playbook_execution(playbook_id: str, idempotency_key: str | None = None, input_context: dict[str, Any] | None = None, single_step_task_id: str | None = None) -> PlaybookMcpResultV1:
    """Start a Playbook execution. Runtime HITL responses remain canvas-owned."""
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/executions",
        require_acting_user_id(),
        {"inputContext": input_context, "singleStepTaskId": single_step_task_id},
        idempotency_key,
    ))


@mcp.tool()
async def list_playbook_executions(playbook_id: str, page: int = 1, limit: int = 10) -> PlaybookMcpResultV1:
    """List execution summaries for an accessible Playbook."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/executions?page={page}&limit={limit}", require_acting_user_id()))


@mcp.tool()
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


@mcp.tool()
async def get_playbook_execution(execution_id: str) -> PlaybookMcpResultV1:
    """Get execution status and results. Pending HITL is status-only."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}", require_acting_user_id()))


@mcp.tool()
async def get_execution_diagnostics(execution_id: str) -> PlaybookMcpResultV1:
    """Get deterministic redacted diagnostics without retrying or mutating an execution."""
    return await mascot_call(backend().get(
        f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/diagnostics",
        require_acting_user_id(),
    ))


@mcp.tool()
async def cancel_playbook_execution(execution_id: str) -> PlaybookMcpResultV1:
    """Cancel a running Playbook execution."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/cancel", require_acting_user_id(), {}))


@mcp.tool()
async def trace_replay_playbook_execution(execution_id: str) -> PlaybookMcpResultV1:
    """Trace replay an execution from recorded events without runtime mutation."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/trace-replay", require_acting_user_id(), {}))


@mcp.tool()
async def reexecute_playbook_execution(execution_id: str) -> PlaybookMcpResultV1:
    """Start a new execution using the source execution inputs."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/re-execute", require_acting_user_id(), {}))


@mcp.tool()
async def run_playbook_from_step(execution_id: str, task_id: str, iteration: int | None = None) -> PlaybookMcpResultV1:
    """Start a new execution downstream of a completed step; this never resumes HITL."""
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/run-from-step",
        require_acting_user_id(),
        {"taskId": task_id, "iteration": iteration},
    ))


@mcp.tool()
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
