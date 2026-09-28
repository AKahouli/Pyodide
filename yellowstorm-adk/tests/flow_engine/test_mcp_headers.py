"""_build_headers merge precedence.

Regression coverage for a live 401: a connector (linkup) carries its
MCP-gateway secret in server_config["headers"]["Authorization"], but once a
per-user credential also resolves to an "Authorization" header, the old
merge order let that resolved header silently overwrite the gateway secret
-- the gateway rejected the request with 401 and nothing at binding time
pointed at why.
"""
from src.flow_engine.mcp import _build_headers


def test_static_gateway_secret_wins_over_a_colliding_resolved_header():
    server_config = {"headers": {"Authorization": "Bearer GATEWAY_SECRET"}}
    auth_headers = {"Authorization": "Bearer some-other-resolved-credential"}

    merged = _build_headers(server_config, auth_headers)

    assert merged == {"Authorization": "Bearer GATEWAY_SECRET"}


def test_non_colliding_headers_from_both_sources_are_kept():
    server_config = {"headers": {"Authorization": "Bearer GATEWAY_SECRET"}}
    auth_headers = {"x-conversation-id": "session-1"}

    merged = _build_headers(server_config, auth_headers)

    assert merged == {"Authorization": "Bearer GATEWAY_SECRET", "x-conversation-id": "session-1"}


def test_auth_headers_alone_pass_through_when_no_static_config():
    merged = _build_headers(None, {"Authorization": "Bearer USER_TOKEN"})
    assert merged == {"Authorization": "Bearer USER_TOKEN"}


def test_returns_none_when_neither_source_has_headers():
    assert _build_headers(None, None) is None
    assert _build_headers({}, {}) is None


def test_a_collision_is_logged_so_it_is_not_silently_rediscovered_later(caplog):
    server_config = {"headers": {"Authorization": "Bearer GATEWAY_SECRET"}}
    auth_headers = {"Authorization": "Bearer some-other-resolved-credential"}

    with caplog.at_level("WARNING"):
        _build_headers(server_config, auth_headers, action_key="linkup-search")

    assert any(
        "mcp_header_collision" in r.message and "linkup-search" in r.message
        for r in caplog.records
    )


def test_no_warning_when_headers_do_not_collide(caplog):
    server_config = {"headers": {"Authorization": "Bearer GATEWAY_SECRET"}}
    auth_headers = {"x-conversation-id": "session-1"}

    with caplog.at_level("WARNING"):
        _build_headers(server_config, auth_headers, action_key="linkup-search")

    assert not any("mcp_header_collision" in r.message for r in caplog.records)
