import os
from typing import Any, Literal
from urllib.parse import quote

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse

from auth import TrustedIdentityMiddleware, require_acting_user_id
from clients.yellowstorm_playbook_client import PlaybookBackendError, YellowStormPlaybookClient
from config import Settings


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


async def call(operation) -> dict[str, Any]:
    try:
        result = await operation
        return result if isinstance(result, dict) else {"result": result}
    except PlaybookBackendError as exc:
        return exc.as_result()


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
async def open_playbook_context(playbook_id: str, selected_task_id: str | None = None, execution_id: str | None = None) -> dict[str, Any]:
    """Open permission-filtered canonical Playbook context. Runtime HITL is status-only."""
    payload = {"selectedTaskId": selected_task_id, "executionId": execution_id}
    result = await call(backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/context", require_acting_user_id(), payload))
    execution = result.get("execution") if isinstance(result, dict) else None
    if isinstance(execution, dict) and execution.get("waitingForHumanInput") is True:
        result["assistantStatus"] = "runtime_hitl_required"
        result["message"] = "Continue in the existing Playbook runtime HITL panel."
    return result


@mcp.tool()
async def get_playbook_summary(playbook_id: str) -> dict[str, Any]:
    """Get a canonical workflow summary and its current definition revision."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/summary", require_acting_user_id()))


@mcp.tool()
async def get_task_details(playbook_id: str, task_id: str) -> dict[str, Any]:
    """Get the complete design-time definition of an existing task."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/tasks/{path_id(task_id)}", require_acting_user_id()))


@mcp.tool()
async def get_task_dependencies(playbook_id: str, task_id: str) -> dict[str, Any]:
    """Explain incoming/outgoing control dependencies and data bindings for a task."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/tasks/{path_id(task_id)}/dependencies", require_acting_user_id()))


@mcp.tool()
async def validate_playbook(playbook_id: str) -> dict[str, Any]:
    """Run deterministic validation against the canonical Playbook definition."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/validation", require_acting_user_id()))


@mcp.tool()
async def start_playbook_construction(
    playbook_id: str,
    context_id: str,
    request: str,
    expected_definition_revision: int,
    selected_task_id: str | None = None,
) -> dict[str, Any]:
    """Start incremental workflow construction. This returns a preview operation and never applies it."""
    payload = {
        "contextId": context_id,
        "intent": request,
        "selectedTaskId": selected_task_id,
        "expectedDefinitionRevision": expected_definition_revision,
    }
    result = await call(backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/constructions", require_acting_user_id(), payload))
    operation_id = result.get("operationId")
    if isinstance(operation_id, str):
        result["canvasUrl"] = f"/#/playbooks/{path_id(playbook_id)}?assistantOperation={path_id(operation_id)}"
        result["eventStreamOwner"] = "playbook_canvas"
    return result


@mcp.tool()
async def get_playbook_construction(playbook_id: str, operation_id: str) -> dict[str, Any]:
    """Get current construction status and the last emitted sequence."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/constructions/{path_id(operation_id)}", require_acting_user_id()))


@mcp.tool()
async def cancel_playbook_construction(playbook_id: str, operation_id: str, reason: str | None = None) -> dict[str, Any]:
    """Cancel a construction operation. Any frontend preview must be discarded."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/constructions/{path_id(operation_id)}/cancel", require_acting_user_id(), {"reason": reason}))


@mcp.tool()
async def analyze_task_optimization(
    playbook_id: str,
    task_id: str,
    execution_id: str | None = None,
    dimensions: list[Literal["clarity", "agent", "model", "tools", "inputs", "outputs", "bindings", "cost", "latency", "determinism"]] | None = None,
) -> dict[str, Any]:
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
) -> dict[str, Any]:
    """Start an incremental Advisor/Judge remediation preview. It does not apply or create a Playbook."""
    payload = {
        "executionId": execution_id,
        "selectedTaskId": selected_task_id,
        "mode": mode,
        "items": items,
        "expectedDefinitionRevision": expected_definition_revision,
    }
    result = await call(backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/advisor-remediation-constructions", require_acting_user_id(), payload))
    operation_id = result.get("operationId")
    if isinstance(operation_id, str):
        result["canvasUrl"] = f"/#/playbooks/{path_id(playbook_id)}?assistantOperation={path_id(operation_id)}&assistantPreview=advisor"
        result["eventStreamOwner"] = "playbook_canvas"
    return result


@mcp.tool()
async def analyze_workflow_optimization(
    playbook_id: str,
    execution_id: str | None = None,
    dimensions: list[Literal["clarity", "agent", "model", "tools", "inputs", "outputs", "bindings", "cost", "latency", "determinism"]] | None = None,
) -> dict[str, Any]:
    """Analyze the complete workflow and optional execution evidence without mutation."""
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/workflow-optimization",
        require_acting_user_id(),
        {"executionId": execution_id, "dimensions": dimensions},
    ))


@mcp.tool()
async def start_workflow_optimization(
    playbook_id: str,
    context_id: str,
    request: str,
    expected_definition_revision: int,
    execution_id: str | None = None,
) -> dict[str, Any]:
    """Start a durable canvas-owned workflow optimization construction."""
    optimization_request = request if execution_id is None else f"{request}\nUse execution evidence from execution {execution_id}."
    return await start_playbook_construction(playbook_id, context_id, optimization_request, expected_definition_revision)


@mcp.tool()
async def create_playbook(name: str, description: str | None = None, workspace_ids: list[str] | None = None) -> dict[str, Any]:
    """Create an empty canonical Playbook owned by the acting user."""
    return await call(backend().post(
        "/api/v1/internal/playbook-assistant/playbooks",
        require_acting_user_id(),
        {"name": name, "description": description, "workspaces": workspace_ids or []},
    ))


@mcp.tool()
async def clone_playbook(playbook_id: str) -> dict[str, Any]:
    """Clone an accessible Playbook for the acting user."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/clone", require_acting_user_id(), {}))


@mcp.tool()
async def revert_playbook_construction(playbook_id: str, operation_id: str) -> dict[str, Any]:
    """Revert one committed assistant operation if no later Playbook revision exists."""
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/constructions/{path_id(operation_id)}/revert",
        require_acting_user_id(),
        {},
    ))


@mcp.tool()
async def start_playbook_execution(playbook_id: str, idempotency_key: str, input_context: dict[str, Any] | None = None, single_step_task_id: str | None = None) -> dict[str, Any]:
    """Start a Playbook execution. Runtime HITL responses remain canvas-owned."""
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/executions",
        require_acting_user_id(),
        {"inputContext": input_context, "singleStepTaskId": single_step_task_id},
        idempotency_key,
    ))


@mcp.tool()
async def list_playbook_executions(playbook_id: str, page: int = 1, limit: int = 10) -> dict[str, Any]:
    """List execution summaries for an accessible Playbook."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/playbooks/{path_id(playbook_id)}/executions?page={page}&limit={limit}", require_acting_user_id()))


@mcp.tool()
async def get_playbook_execution(execution_id: str) -> dict[str, Any]:
    """Get execution status and results. Pending HITL is status-only."""
    return await call(backend().get(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}", require_acting_user_id()))


@mcp.tool()
async def cancel_playbook_execution(execution_id: str) -> dict[str, Any]:
    """Cancel a running Playbook execution."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/cancel", require_acting_user_id(), {}))


@mcp.tool()
async def trace_replay_playbook_execution(execution_id: str) -> dict[str, Any]:
    """Trace replay an execution from recorded events without runtime mutation."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/trace-replay", require_acting_user_id(), {}))


@mcp.tool()
async def reexecute_playbook_execution(execution_id: str) -> dict[str, Any]:
    """Start a new execution using the source execution inputs."""
    return await call(backend().post(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/re-execute", require_acting_user_id(), {}))


@mcp.tool()
async def run_playbook_from_step(execution_id: str, task_id: str, iteration: int | None = None) -> dict[str, Any]:
    """Start a new execution downstream of a completed step; this never resumes HITL."""
    return await call(backend().post(
        f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}/run-from-step",
        require_acting_user_id(),
        {"taskId": task_id, "iteration": iteration},
    ))


@mcp.tool()
async def delete_playbook_execution(execution_id: str) -> dict[str, Any]:
    """Delete one accessible execution and its associated records."""
    return await call(backend().delete(f"/api/v1/internal/playbook-assistant/executions/{path_id(execution_id)}", require_acting_user_id()))


if __name__ == "__main__":
    settings.validate()
    os.environ.setdefault("HOST", "0.0.0.0")
    middleware = [Middleware(TrustedIdentityMiddleware, ingress_token=settings.ingress_token)]
    mcp.run(transport="streamable-http", host="0.0.0.0", port=settings.port, middleware=middleware)
