import httpx
import pytest

from src.guardrails import mascot_tool_policy


def config():
    return {
        "id": "agent-1",
        "agent_type": "platform_copilot",
        "user_id": "user-1",
        "agent_params": {
            "platform_api_url": "http://platform/api",
            "platform_api_token": "internal-secret",
            "mascot_tenant_id": "default",
            "mascot_conversation_id": "conversation-1",
            "mascot_correlation_id": "correlation-1",
        },
    }


@pytest.mark.asyncio
async def test_denies_tools_outside_second_brain_allowlist():
    result = await mascot_tool_policy.evaluate_second_brain_tool(
        config(), "playbook_mcp_delete_playbook_execution", {}, {"action_key": "delete_playbook_execution"}
    )
    assert result["decision"] == "denied"
    assert result["code"] == "MASCOT_TOOL_NOT_ALLOWED"


@pytest.mark.asyncio
async def test_injects_server_idempotency_key_after_confirmation(monkeypatch):
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"success": True, "data": {"decision": "allowed", "idempotencyKey": "server-key"}}

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, *_args, **_kwargs):
            return Response()

    monkeypatch.setattr(mascot_tool_policy.httpx, "AsyncClient", lambda **_kwargs: Client())
    args = {"playbook_id": "playbook-1"}
    result = await mascot_tool_policy.evaluate_second_brain_tool(
        config(), "playbook_mcp_start_playbook_execution", args, {"action_key": "start_playbook_execution"}
    )
    assert result["decision"] == "allowed"
    assert args["idempotency_key"] == "server-key"


@pytest.mark.asyncio
async def test_fails_closed_when_policy_is_unavailable(monkeypatch):
    class Client:
        async def __aenter__(self):
            raise httpx.ConnectError("offline")

        async def __aexit__(self, *_args):
            return None

    monkeypatch.setattr(mascot_tool_policy.httpx, "AsyncClient", lambda **_kwargs: Client())
    result = await mascot_tool_policy.evaluate_second_brain_tool(
        config(), "playbook_mcp_search_playbooks", {}, {"action_key": "search_playbooks"}
    )
    assert result["decision"] == "denied"
    assert result["code"] == "MASCOT_POLICY_UNAVAILABLE"
