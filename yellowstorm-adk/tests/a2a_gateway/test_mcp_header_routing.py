import json

from src.a2a_gateway.card import build_agent_card
from src.a2a_gateway.executor import RunSingleAgentExecutor, _route_mcp_headers


def test_card_advertises_per_connector_mcp_scheme():
    definition = {
        "id": "a1", "name": "gh agent",
        "agent_params": {"params": {"connector_bindings_json": json.dumps(
            [{"connector_slug": "github"}, {"connector_slug": "jira"}]
        )}},
    }
    card = build_agent_card(definition, "https://h/a2a/a1", "X-API-Key")
    schemes = card.security_schemes
    assert set(schemes) == {"apiKey", "mcp-github", "mcp-jira"}
    assert schemes["mcp-github"].root.name == "X-MCP-github-Authorization"
    # per-connector schemes are optional: only apiKey is required
    assert card.security == [{"apiKey": []}]


def test_card_no_connectors_only_apikey():
    card = build_agent_card({"id": "a1", "name": "x"}, "https://h/a2a/a1", "X-API-Key")
    assert set(card.security_schemes) == {"apiKey"}


def test_routes_per_slug_longest_wins_and_canonizes():
    headers = {
        "x-mcp-github-authorization": "Bearer gh",
        "x-mcp-jira-cloud-x-jira-token": "jt",   # hyphenated slug + hyphenated header
        "x-api-key": "gateway-secret",            # not forwarded
        "host": "example.com",                    # not forwarded
    }
    routed = _route_mcp_headers(headers, ["github", "jira", "jira-cloud"])
    assert routed == {
        "github": {"Authorization": "Bearer gh"},
        "jira-cloud": {"X-Jira-Token": "jt"},
    }


def test_empty_when_no_mcp_headers():
    assert _route_mcp_headers({"authorization": "x"}, ["github"]) == {}


def test_build_request_injects_caller_pat_into_github_binding():
    """End-to-end on the executor: a caller's X-MCP-github-Authorization lands in
    the github binding's auth_headers inside the gRPC Agent proto, and a non-github
    binding is left untouched."""
    bindings = [
        {"connector_slug": "github", "mcp_server_url": "https://mcp-github.yellowmind.ai",
         "actions": ["create_issue"]},
        {"connector_slug": "jira", "actions": ["search"]},
    ]
    definition = {
        "id": "agent-1",
        "agentParams": {"params": {"connector_bindings_json": json.dumps(bindings)}},
    }
    ex = RunSingleAgentExecutor(
        "localhost:1", definition,
        caller_mcp_headers={"x-mcp-github-authorization": "Bearer ghp_abc"},
    )
    req = ex._build_request("hi", "conv-1")
    out = json.loads(req.agent.agent_params.params["connector_bindings_json"])
    gh = next(b for b in out if b["connector_slug"] == "github")
    jira = next(b for b in out if b["connector_slug"] == "jira")
    assert gh["auth_headers"] == {"Authorization": "Bearer ghp_abc"}
    assert "auth_headers" not in jira  # not targeted → untouched
