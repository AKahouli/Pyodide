"""Build an A2A Agent Card from a stored agent definition."""

from typing import Any, Dict

from a2a.types import (
    AgentCard,
    AgentCapabilities,
    AgentSkill,
    APIKeySecurityScheme,
    SecurityScheme,
)

API_KEY_SCHEME = "apiKey"


def build_agent_card(
    definition: Dict[str, Any],
    public_url: str,
    api_key_header: str,
) -> AgentCard:
    """Create the card Copilot Studio reads to discover the agent.

    Args:
        definition: the stored `Agent` proto-json.
        public_url: the message endpoint, e.g. ``https://host/a2a/{agent_id}``.
        api_key_header: header the client must send the API key in.
    """
    name = definition.get("name") or "Agent"
    description = definition.get("description") or definition.get("prompt") or name
    agent_id = definition.get("id") or name

    return AgentCard(
        name=name,
        description=description[:512],
        version="1.0.0",
        url=public_url.rstrip("/"),
        preferred_transport="JSONRPC",
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        capabilities=AgentCapabilities(streaming=True),
        security_schemes={
            API_KEY_SCHEME: SecurityScheme(
                root=APIKeySecurityScheme(
                    type="apiKey", in_="header", name=api_key_header,
                    description="Per-agent API key issued when the agent was published.",
                )
            )
        },
        security=[{API_KEY_SCHEME: []}],
        skills=[
            AgentSkill(
                id=f"{agent_id}-chat",
                name=name,
                description=description[:512],
                tags=["llm", "tools"],
            )
        ],
    )
