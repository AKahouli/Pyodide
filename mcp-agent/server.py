import json
import os
from collections.abc import Callable
from typing import Any
from urllib.parse import quote

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from auth import TrustedIdentityMiddleware, require_acting_user_id, require_actor_context
from clients.yellowstorm_agent_client import AgentBackendError, YellowStormAgentClient
from config import Settings
from contracts import AgentMcpResultV1, failure_result, success_result


settings = Settings.from_env()
mcp = FastMCP("Agent MCP")
_client: YellowStormAgentClient | None = None

BASE = "/api/v1/internal/agent-crud"


def backend() -> YellowStormAgentClient:
    global _client
    if _client is None:
        _client = YellowStormAgentClient(
            settings.backend_url,
            settings.internal_token,
            settings.timeout_seconds,
            settings.max_response_bytes,
        )
    return _client


async def call(
    operation,
    transform: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> AgentMcpResultV1:
    correlation_id = require_actor_context().correlation_id
    try:
        result = await operation
        data = result if isinstance(result, dict) else {"result": result}
        if transform is not None:
            data = transform(data)
        return success_result(data, correlation_id)
    except AgentBackendError as exc:
        return failure_result(
            exc.code,
            str(exc),
            exc.status_code,
            correlation_id,
            exc.details,
        )


def path_id(value: str) -> str:
    return quote(value, safe="")


def compact(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def coerce_members(value: list[dict[str, Any]] | str) -> list[dict[str, Any]]:
    # Models routinely serialize list arguments as a JSON string; accept it at the tool boundary.
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("members must be a list of objects or a JSON-encoded list") from exc
    else:
        parsed = value
    if not isinstance(parsed, list) or not all(isinstance(item, dict) for item in parsed):
        raise ValueError("members must be a list of objects")

    members = []
    for item in parsed:
        member = compact({
            "agentId": item.get("agent_id") or item.get("agentId"),
            "parentAgentId": item.get("parent_agent_id", item.get("parentAgentId", None)),
            "order": item.get("order"),
            "positionX": item.get("position_x", item.get("positionX", None)),
            "positionY": item.get("position_y", item.get("positionY", None)),
        })
        if "agentId" not in member:
            raise ValueError("each member requires agent_id")
        members.append(member)
    return members


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


@mcp.tool()
async def list_agent_types() -> AgentMcpResultV1:
    """List active agent types usable when creating agents."""
    return await call(backend().get(f"{BASE}/agent-types", require_acting_user_id()))


@mcp.tool()
async def list_models() -> AgentMcpResultV1:
    """List available LLM models assignable to agents."""
    return await call(backend().get(f"{BASE}/models", require_acting_user_id()))


@mcp.tool()
async def list_agents() -> AgentMcpResultV1:
    """List all agents visible to the acting user (personal and default)."""
    return await call(backend().get(f"{BASE}/agents", require_acting_user_id()))


@mcp.tool()
async def get_agent(agent_id: str) -> AgentMcpResultV1:
    """Get one agent by id with its full configuration."""
    return await call(backend().get(f"{BASE}/agents/{path_id(agent_id)}", require_acting_user_id()))


@mcp.tool()
async def create_agent(
    name: str,
    agent_type_id: str,
    role: str,
    description: str | None = None,
    instruction: str | None = None,
    model: str | None = None,
    temperature: float | None = None,
) -> AgentMcpResultV1:
    """Create a new personal agent owned by the acting user and return it with its id."""
    payload = compact({
        "name": name,
        "agentType": agent_type_id,
        "role": role,
        "description": description,
        "instruction": instruction,
        "model": model,
        "temperature": temperature,
    })
    return await call(backend().post(f"{BASE}/agents", require_acting_user_id(), payload))


@mcp.tool()
async def update_agent(
    agent_id: str,
    name: str | None = None,
    role: str | None = None,
    description: str | None = None,
    instruction: str | None = None,
    model: str | None = None,
    temperature: float | None = None,
    is_active: bool | None = None,
) -> AgentMcpResultV1:
    """Update an existing personal agent; only provided fields change."""
    payload = compact({
        "name": name,
        "role": role,
        "description": description,
        "instruction": instruction,
        "model": model,
        "temperature": temperature,
        "isActive": is_active,
    })
    return await call(backend().patch(f"{BASE}/agents/{path_id(agent_id)}", require_acting_user_id(), payload))


@mcp.tool()
async def delete_agent(agent_id: str) -> AgentMcpResultV1:
    """Delete one personal agent and remove it from all teams it belongs to."""
    return await call(backend().delete(f"{BASE}/agents/{path_id(agent_id)}", require_acting_user_id()))


@mcp.tool()
async def list_teams() -> AgentMcpResultV1:
    """List all active teams visible to the acting user (owned and shared)."""
    return await call(backend().get(f"{BASE}/teams", require_acting_user_id()))


@mcp.tool()
async def get_team(team_id: str) -> AgentMcpResultV1:
    """Get one team with its member agents and hierarchy."""
    return await call(backend().get(f"{BASE}/teams/{path_id(team_id)}", require_acting_user_id()))


@mcp.tool()
async def create_team(
    name: str,
    description: str | None = None,
    agent_ids: list[str] | None = None,
) -> AgentMcpResultV1:
    """Create a new team owned by the acting user and return it with its id."""
    payload = compact({
        "name": name,
        "description": description,
        "agentIds": agent_ids,
    })
    return await call(backend().post(f"{BASE}/teams", require_acting_user_id(), payload))


@mcp.tool()
async def update_team(
    team_id: str,
    name: str | None = None,
    description: str | None = None,
    agent_ids: list[str] | None = None,
    is_active: bool | None = None,
) -> AgentMcpResultV1:
    """Update team metadata or reconcile its flat agent list; only provided fields change."""
    payload = compact({
        "name": name,
        "description": description,
        "agentIds": agent_ids,
        "isActive": is_active,
    })
    return await call(backend().patch(f"{BASE}/teams/{path_id(team_id)}", require_acting_user_id(), payload))


@mcp.tool()
async def update_team_hierarchy(team_id: str, members: list[dict[str, Any]] | str) -> AgentMcpResultV1:
    """Replace the team hierarchy. Each member is {"agent_id", "parent_agent_id", "order", "position_x", "position_y"}; parent_agent_id null means root."""
    payload = {"members": coerce_members(members)}
    return await call(backend().patch(f"{BASE}/teams/{path_id(team_id)}/hierarchy", require_acting_user_id(), payload))


@mcp.tool()
async def delete_team(team_id: str) -> AgentMcpResultV1:
    """Delete one owned team and its shares."""
    return await call(backend().delete(f"{BASE}/teams/{path_id(team_id)}", require_acting_user_id()))


if __name__ == "__main__":
    settings.validate()
    os.environ.setdefault("HOST", "0.0.0.0")
    middleware = [Middleware(
        TrustedIdentityMiddleware,
        ingress_token=settings.ingress_token,
    )]
    mcp.run(transport="streamable-http", host="0.0.0.0", port=settings.port, middleware=middleware)
