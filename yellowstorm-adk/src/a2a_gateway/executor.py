"""A2A executor that delegates to the RunSingleAgent gRPC service.

Builds a ``RunSingleAgentRequest`` from a stored agent definition and maps the
streamed ``StreamChunk``s back to A2A events. This is the multi-tenant version
of the standalone adapter: the agent definition is injected per instance.
"""

import json
from typing import Any, Dict

import grpc
from google.protobuf import json_format

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import Part, TextPart, TaskState
from a2a.utils import new_task, new_agent_text_message

from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc
from src.logger.logging import get_logger

logger = get_logger("api.a2a_gateway.executor")

_MCP_HEADER_PREFIX = "x-mcp-"


def _route_mcp_headers(
    caller_headers: Dict[str, str], slugs: list[str]
) -> Dict[str, Dict[str, str]]:
    """Map ``X-MCP-<slug>-<Header>`` caller headers to ``{slug: {Header: value}}``.

    Keys arrive lowercased (Starlette), so the slug is matched lowercased and the
    longest slug wins (``jira`` vs ``jira-cloud``). The header name is re-canonized
    (``authorization`` -> ``Authorization``) so the connector's collision check
    against its static ``mcp_server_config.headers`` still fires.
    """
    ordered = sorted({s.lower() for s in slugs if s}, key=len, reverse=True)
    routed: Dict[str, Dict[str, str]] = {}
    for key, value in caller_headers.items():
        low = key.lower()
        if not low.startswith(_MCP_HEADER_PREFIX):
            continue
        rest = low[len(_MCP_HEADER_PREFIX):]
        for slug in ordered:
            if rest.startswith(slug + "-"):
                name = "-".join(p.capitalize() for p in rest[len(slug) + 1:].split("-") if p)
                if name:
                    routed.setdefault(slug, {})[name] = value
                break
    return routed


class RunSingleAgentExecutor(AgentExecutor):
    """Forwards an A2A turn to RunSingleAgent for a single stored agent."""

    def __init__(
        self,
        grpc_target: str,
        definition: Dict[str, Any],
        caller_mcp_headers: Dict[str, str] | None = None,
    ):
        self._target = grpc_target
        self._definition = definition
        self._caller_mcp_headers = caller_mcp_headers or {}

    def _inject_caller_mcp_headers(self, agent) -> None:
        """Fold the A2A caller's X-MCP-* headers into each connector binding's
        ``auth_headers``, routed per connector slug. No-op without callers/bindings."""
        if not self._caller_mcp_headers or not agent.HasField("agent_params"):
            return
        params = agent.agent_params.params
        raw = params.get("connector_bindings_json")
        if not raw:
            return
        try:
            bindings = json.loads(raw)
        except (TypeError, ValueError):
            return
        if not isinstance(bindings, list):
            return
        slugs = [
            str(b.get("connector_slug") or b.get("connector_name") or "")
            for b in bindings
            if isinstance(b, dict)
        ]
        routed = _route_mcp_headers(self._caller_mcp_headers, slugs)
        if not routed:
            # Caller sent X-MCP-* but none matched a connector slug on this agent.
            logger.info(
                "a2a_mcp_headers_no_match agent=%s caller_header_names=%s known_slugs=%s",
                agent.id or "?",
                sorted(self._caller_mcp_headers.keys()),
                sorted({s.lower() for s in slugs if s}),
            )
            return
        for b in bindings:
            if not isinstance(b, dict):
                continue
            slug = str(b.get("connector_slug") or b.get("connector_name") or "").lower()
            if slug in routed:
                b.setdefault("auth_headers", {}).update(routed[slug])
        params["connector_bindings_json"] = json.dumps(bindings)
        # Header NAMES only — never log token values.
        logger.info(
            "a2a_mcp_headers_injected agent=%s routed=%s",
            agent.id or "?",
            {slug: sorted(h.keys()) for slug, h in routed.items()},
        )

    def _build_request(self, user_text: str, conversation_id: str):
        agent = chatbot_pb2.Agent()
        json_format.ParseDict(self._definition, agent, ignore_unknown_fields=True)
        self._inject_caller_mcp_headers(agent)

        request = chatbot_pb2.RunSingleAgentRequest(
            user_context=chatbot_pb2.UserContext(
                user_id="copilot-studio", username="copilot-studio"
            ),
            conversation_id=conversation_id,
            query=user_text,
            agent=agent,
        )
        # Mirror the agent's knowledge bases / skills to the request level so the
        # mono pipeline picks up brain documents and skills (same as the team path).
        if agent.brain_context:
            request.workspace_context.extend(agent.brain_context)
        if agent.skills:
            request.skills.extend(agent.skills)
        return request

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        user_text = context.get_user_input()

        task = context.current_task
        if task is None:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)
        await updater.start_work()

        request = self._build_request(user_text, task.context_id)
        full_text_parts: list[str] = []
        error_text: str | None = None

        try:
            async with grpc.aio.insecure_channel(self._target) as channel:
                stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)
                async for chunk in stub.RunSingleAgent(request):
                    comp = chunk.component
                    kind = comp.WhichOneof("data")
                    if kind == "text":
                        piece = comp.text.content
                        if piece:
                            full_text_parts.append(piece)
                            await updater.update_status(
                                TaskState.working,
                                message=new_agent_text_message(
                                    piece, task.context_id, task.id
                                ),
                            )
                    elif kind == "error":
                        error_text = comp.error.content or comp.error.title or "error"
        except grpc.aio.AioRpcError as exc:
            error_text = f"gRPC call failed: {exc.code()} - {exc.details()}"
            logger.error(error_text)

        if error_text is not None:
            await updater.failed(
                message=new_agent_text_message(error_text, task.context_id, task.id)
            )
            return

        full_text = "".join(full_text_parts).strip() or "(no response)"
        await updater.add_artifact(
            [Part(root=TextPart(text=full_text))], name="response", last_chunk=True
        )
        await updater.complete()

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        if context.current_task is not None:
            updater = TaskUpdater(event_queue, context.task_id, context.context_id)
            await updater.cancel()
