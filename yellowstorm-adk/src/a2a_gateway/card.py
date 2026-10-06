"""Build an A2A Agent Card from a stored agent definition."""

import json
from typing import Any, Dict, List

from a2a.types import (
    AgentCard,
    AgentCapabilities,
    AgentSkill,
    APIKeySecurityScheme,
    SecurityScheme,
)

API_KEY_SCHEME = "apiKey"


def _connector_slugs(definition: Dict[str, Any]) -> List[str]:
    """Distinct connector slugs from the agent's connector_bindings_json, in order.

    The definition is proto-json; PublishAgent stores snake_case, but accept
    camelCase too. Returns [] on anything malformed — the card must still build.
    """
    params = (definition.get("agent_params") or definition.get("agentParams") or {}).get("params") or {}
    raw = params.get("connector_bindings_json")
    if not raw:
        return []
    try:
        bindings = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(bindings, list):
        return []
    slugs: List[str] = []
    for b in bindings:
        if not isinstance(b, dict):
            continue
        slug = str(b.get("connector_slug") or b.get("connector_name") or "").strip()
        if slug and slug not in slugs:
            slugs.append(slug)
    return slugs


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

    security_schemes = {
        API_KEY_SCHEME: SecurityScheme(
            root=APIKeySecurityScheme(
                type="apiKey", in_="header", name=api_key_header,
                description="Per-agent API key issued when the agent was published.",
            )
        )
    }
    # Advertise per-connector auth headers so a caller can discover that it may
    # pass its own credential per connector. Optional (not added to `security`):
    # X-MCP-<slug>-<HeaderName>: <value>, e.g. Authorization: Bearer <token>.
    for slug in _connector_slugs(definition):
        security_schemes[f"mcp-{slug}"] = SecurityScheme(
            root=APIKeySecurityScheme(
                type="apiKey", in_="header", name=f"X-MCP-{slug}-Authorization",
                description=(
                    f"Optional per-caller credential for the '{slug}' connector. "
                    f"Send as X-MCP-{slug}-<HeaderName>: <value> "
                    f"(e.g. X-MCP-{slug}-Authorization: Bearer <token>)."
                ),
            )
        )

    return AgentCard(
        name=name,
        description=description[:512],
        version="1.0.0",
        url=public_url.rstrip("/"),
        preferred_transport="JSONRPC",
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        capabilities=AgentCapabilities(streaming=True),
        security_schemes=security_schemes,
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
