"""gRPC servicer for A2A agent management (publish / rotate / enable / get).

Unary RPCs backed by the same A2A agent store used by the HTTP serving routes.
The A2A serving surface (card + message endpoint) stays HTTP/JSON-RPC.
"""

import grpc
from google.protobuf import json_format

from src.grpc_generated import a2a_admin_pb2, a2a_admin_pb2_grpc
from src.a2a_gateway.repository import A2AAgentRepository
from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger("api.grpc.a2a_admin")


def _api_key_header() -> str:
    return getattr(get_settings(), "A2A_API_KEY_HEADER", None) or "X-API-Key"


def _public_url(agent_id: str) -> str:
    base = (getattr(get_settings(), "A2A_PUBLIC_BASE_URL", None) or "").rstrip("/")
    return f"{base}/a2a/{agent_id}" if base else f"/a2a/{agent_id}"


class A2AAdminServicer(a2a_admin_pb2_grpc.A2AAdminServiceServicer):
    """Manage published A2A agents."""

    async def PublishAgent(self, request, context):
        agent_id = (request.agent.id or "").strip()
        if not agent_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "agent.id is required")

        definition = json_format.MessageToDict(
            request.agent, preserving_proto_field_name=True
        )
        name = request.agent.name or agent_id
        api_key = await A2AAgentRepository.upsert(
            agent_id=agent_id,
            name=name,
            definition=definition,
            user_id=request.user_id or None,
        )
        url = _public_url(agent_id)
        logger.info(f"[gRPC] A2A agent published: {agent_id}")
        return a2a_admin_pb2.PublishAgentResponse(
            agent_id=agent_id,
            url=url,
            agent_card_url=f"{url}/.well-known/agent-card.json",
            api_key=api_key,
            api_key_header=_api_key_header(),
        )

    async def RotateKey(self, request, context):
        api_key = await A2AAgentRepository.rotate_key(request.agent_id)
        if api_key is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "agent not found")
        return a2a_admin_pb2.RotateKeyResponse(
            agent_id=request.agent_id,
            api_key=api_key,
            api_key_header=_api_key_header(),
        )

    async def SetAgentEnabled(self, request, context):
        ok = await A2AAgentRepository.set_enabled(request.agent_id, request.enabled)
        if not ok:
            await context.abort(grpc.StatusCode.NOT_FOUND, "agent not found")
        return a2a_admin_pb2.SetAgentEnabledResponse(
            agent_id=request.agent_id, enabled=request.enabled
        )

    async def GetAgent(self, request, context):
        agent = await A2AAgentRepository.get(request.agent_id)
        if agent is None:
            return a2a_admin_pb2.GetAgentResponse(found=False, agent_id=request.agent_id)
        return a2a_admin_pb2.GetAgentResponse(
            found=True,
            agent_id=agent.agent_id,
            name=agent.name or "",
            enabled=bool(agent.enabled),
            api_key_prefix=agent.api_key_prefix or "",
            created_at=agent.created_at.isoformat() if agent.created_at else "",
            updated_at=agent.updated_at.isoformat() if agent.updated_at else "",
        )
