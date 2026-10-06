"""Selected hydration uses internal authority and the existing protobuf converter."""
from types import SimpleNamespace

import httpx
import pytest

from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from src.root_runtime import delegate_resolver


@pytest.mark.asyncio
async def test_settlement_preserves_full_output_and_bounds_root_summary(monkeypatch):
    sent = []

    async def post(scope, route, payload):
        sent.append(payload)
        return payload

    monkeypatch.setattr(delegate_resolver, '_post', post)
    output = 'x' * 9000
    await delegate_resolver.settle_delegate(None, 'child', 'completed', output)
    assert sent == [{'status': 'completed', 'text': output[:8000], 'fullText': output}]
    with pytest.raises(ValueError, match='durable result limit'):
        await delegate_resolver.settle_delegate(None, 'child', 'completed', '\U0001f600' * 65537)
    assert len(sent) == 1


@pytest.mark.asyncio
async def test_selected_definition_keeps_native_model_and_binding_contract(monkeypatch):
    # Load SDK clients before replacing AsyncClient with our transport factory.
    from src.grpc_server.chatbot_servicer import ChatbotServicer
    sent = []
    real_client = httpx.AsyncClient
    monkeypatch.setenv("PLATFORM_API_URL", "http://platform.test/api")
    monkeypatch.setattr(delegate_resolver, "get_settings", lambda: SimpleNamespace(
        API_URL="http://unused.test", INTERNAL_SERVICE_SECRET="internal-test-token"))

    def respond(request):
        sent.append(request)
        return httpx.Response(201, json={"data": {"executionId": "2" * 24, "definition": {
            "id": "worker", "name": "specialist", "prompt": "own prompt", "tools": [],
            "chatbot": {"model": "worker-native-model"},
            "brain_context": [{"workspace_id": "own-workspace", "workspace_name": "Own"}],
            "agent_params": {"params": {"connector_bindings_json": "[]"}},
            "connector_bindings": [], "connectorIds": [],
        }}})

    monkeypatch.setattr(delegate_resolver.httpx, "AsyncClient", lambda **kwargs:
        real_client(transport=httpx.MockTransport(respond), **kwargs))
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id="1" * 24)
    resolved = await delegate_resolver.resolve_delegate_definition(scope, "call", "delegate_to_agent@call",
        "worker", "task", "expected", [])
    candidate = resolved["candidate"]
    assert candidate.chatbot_name["provider"] == "worker-native-model"
    assert candidate.brain_ids == ["own-workspace"]
    assert candidate.agent_params["connector_bindings_json"] == "[]"
    assert sent[0].url == "http://platform.test/api/v1/internal/root-work/" + "1" * 24 + "/delegate-definition"
    assert sent[0].headers["X-Internal-Token"] == "internal-test-token"
    assert b"internal-test-token" not in sent[0].content
    assert b"actorId" not in sent[0].content and b"scope" not in sent[0].content


@pytest.mark.asyncio
async def test_missing_internal_authentication_fails_before_network(monkeypatch):
    monkeypatch.setattr(delegate_resolver, "get_settings", lambda: SimpleNamespace(
        API_URL="http://platform.test", INTERNAL_SERVICE_SECRET=None))
    with pytest.raises(RuntimeError, match="authentication"):
        await delegate_resolver.resolve_delegate_definition(ExecutionScopeV1(), "call", "branch", "worker", "task", "", [])
