"""Build a per-agent A2A application from a stored definition.

A2A's ``A2AStarletteApplication`` is built per agent (cheap — just object
construction) and we delegate request handling to its ``_handle_requests`` /
card methods from our parameterized routes. This keeps the SDK's JSON-RPC
parsing/serialization while staying multi-tenant.
"""

from typing import Any, Dict

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore

from src.a2a_gateway.card import build_agent_card
from src.a2a_gateway.executor import RunSingleAgentExecutor


def build_a2a_app(
    definition: Dict[str, Any],
    public_url: str,
    grpc_target: str,
    api_key_header: str,
) -> A2AStarletteApplication:
    card = build_agent_card(definition, public_url, api_key_header)
    handler = DefaultRequestHandler(
        agent_executor=RunSingleAgentExecutor(grpc_target, definition),
        task_store=InMemoryTaskStore(),
    )
    return A2AStarletteApplication(agent_card=card, http_handler=handler)
