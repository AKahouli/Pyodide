"""FastAPI routes for the A2A gateway (serving surface only).

Agent management is exposed over gRPC (see a2a_admin.proto / A2AAdminServicer).
"""

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, Response

from src.a2a_gateway.app_factory import build_a2a_app
from src.a2a_gateway.card import build_agent_card
from src.a2a_gateway.repository import A2AAgentRepository
from src.a2a_gateway.security import verify_api_key
from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger("api.a2a_gateway.router")

_CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*"}


def _grpc_target() -> str:
    s = get_settings()
    return getattr(s, "A2A_GRPC_TARGET", None) or f"127.0.0.1:{s.GRPC_PORT}"


def _api_key_header() -> str:
    return getattr(get_settings(), "A2A_API_KEY_HEADER", None) or "X-API-Key"


def _public_base(request: Request) -> str:
    override = getattr(get_settings(), "A2A_PUBLIC_BASE_URL", None)
    return (override or str(request.base_url)).rstrip("/")


def _public_url(request: Request, agent_id: str) -> str:
    return f"{_public_base(request)}/a2a/{agent_id}"


# Agent management (publish / rotate / enable / get) is exposed over gRPC
# (a2a_admin.proto / A2AAdminServicer), not HTTP. Only the A2A serving surface
# below is HTTP, because it is consumed by external A2A clients.

# -------------------------------------------------------------- serving router

serving_router = APIRouter(prefix="/a2a", tags=["a2a-gateway"])


@serving_router.options("/{agent_id}")
@serving_router.options("/{agent_id}/.well-known/agent-card.json")
async def a2a_preflight(agent_id: str):
    return Response(status_code=200, headers=_CORS)


@serving_router.get("/{agent_id}/.well-known/agent-card.json")
async def agent_card(agent_id: str, request: Request):
    agent = await A2AAgentRepository.get(agent_id)
    if agent is None or not agent.enabled:
        raise HTTPException(status_code=404, detail="agent not found")
    card = build_agent_card(
        agent.definition, _public_url(request, agent_id), _api_key_header()
    )
    return JSONResponse(card.model_dump(mode="json", by_alias=True, exclude_none=True),
                        headers=_CORS)


@serving_router.post("/{agent_id}")
async def a2a_rpc(agent_id: str, request: Request):
    agent = await A2AAgentRepository.get(agent_id)
    if agent is None or not agent.enabled:
        raise HTTPException(status_code=404, detail="agent not found")

    provided = request.headers.get(_api_key_header())
    if not verify_api_key(provided or "", agent.api_key_hash):
        raise HTTPException(status_code=401, detail="invalid or missing API key")

    a2a_app = build_a2a_app(
        agent.definition, _public_url(request, agent_id), _grpc_target(), _api_key_header()
    )
    # Delegate JSON-RPC parsing/dispatch/serialization to the SDK app.
    return await a2a_app._handle_requests(request)
