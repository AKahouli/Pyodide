import pytest
from fastmcp import Client

import server
from auth import PlatformActorContext, actor_context
from server import mcp


def result_dict(response):
    if response.structured_content is not None:
        return response.structured_content
    data = response.data
    while hasattr(data, "root"):
        data = data.root
    if hasattr(data, "model_dump"):
        return data.model_dump()
    return data


@pytest.fixture
def actor():
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    yield
    actor_context.reset(token)


class Recorder:
    def __init__(self, response=None):
        self.calls = []
        self.response = response if response is not None else {"ok": True}

    async def get(self, path, user_id):
        self.calls.append(("GET", path, user_id, None))
        return self.response

    async def post(self, path, user_id, payload=None):
        self.calls.append(("POST", path, user_id, payload))
        return self.response

    async def delete(self, path, user_id):
        self.calls.append(("DELETE", path, user_id, None))
        return self.response


@pytest.mark.asyncio
async def test_registers_the_design_tools_with_the_versioned_envelope():
    async with Client(mcp) as client:
        tools = await client.list_tools()
    assert {tool.name for tool in tools} == {
        "list_semantic_models", "create_semantic_model", "get_semantic_model", "check_semantic_model",
        "apply_model_changes", "list_model_changes", "undo_model_change",
        "list_workspaces", "list_workspace_files", "profile_spreadsheet", "map_spreadsheet", "map_documents", "remove_source",
        "run_data_update", "get_run_status", "stop_data_update", "search_records", "publish_semantic_model", "suggest_sources",
    }
    for tool in tools:
        assert tool.outputSchema["properties"]["schemaVersion"]["const"] == "semantic_model.mcp.v1"
        # ADK fills parameters named workspace_id with the chat's workspace; sources name theirs explicitly.
        assert "workspace_id" not in tool.inputSchema.get("properties", {}), tool.name
    hints = {tool.name: tool.annotations for tool in tools}
    assert hints["get_semantic_model"].readOnlyHint is True
    assert hints["publish_semantic_model"].destructiveHint is True


@pytest.mark.asyncio
async def test_apply_model_changes_turns_a_design_into_one_backend_call(monkeypatch, actor):
    backend = Recorder({"applied": True, "changeId": "change-1"})
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        response = await client.call_tool("apply_model_changes", {
            "model_id": "model/1",
            "concepts": '[{"name": "Invoice", "fields": ["Invoice number", {"label": "Amount", "type": "number"}], "key_fields": ["Invoice number"]},'
                        ' {"concept": "customer", "rename_to": "Client", "remove_fields": ["fax"]}]',
            "relations": [{"source": "Client", "target": "Invoice", "label": "receives", "cardinality": "one_to_many"}],
            "remove_concepts": ["Old"],
        })
    result = result_dict(response)
    assert result["ok"] is True
    assert result["meta"]["changeId"] == "change-1"
    method, path, user_id, payload = backend.calls[0]
    assert (method, path, user_id) == ("POST", "/api/v1/internal/semantic-model-assistant/models/model%2F1/changes", "user-1")
    assert payload == {
        "concepts": [
            {"label": "Invoice", "fields": [{"label": "Invoice number"}, {"label": "Amount", "type": "number"}], "keyFields": ["Invoice number"]},
            {"concept": "customer", "newLabel": "Client", "removeFields": ["fax"]},
        ],
        "relations": [{"from": "Client", "to": "Invoice", "label": "receives", "cardinality": "one_to_many"}],
        "removeConcepts": ["Old"],
        "dryRun": False,
    }


@pytest.mark.asyncio
async def test_apply_model_changes_refuses_an_empty_or_malformed_design(monkeypatch, actor):
    backend = Recorder()
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        empty = result_dict(await client.call_tool("apply_model_changes", {"model_id": "m"}))
        broken = result_dict(await client.call_tool("apply_model_changes", {"model_id": "m", "concepts": "not json"}))
    assert empty["ok"] is False and empty["error"]["category"] == "validation"
    assert broken["ok"] is False and "concepts" in broken["error"]["message"]
    assert backend.calls == []


@pytest.mark.asyncio
async def test_map_documents_sends_picked_files_and_folders(monkeypatch, actor):
    backend = Recorder({"sourceId": "s-1", "changeId": "change-2"})
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        response = await client.call_tool("map_documents", {
            "model_id": "m", "concept": "Contract", "source_workspace_id": "ws-1",
            "folder_ids": '["f-1"]', "document_ids": ["d-1"], "fields": {"Title": "document_name", "Amount": "ai"}, "key_fields": ["Contract number"],
        })
    assert result_dict(response)["ok"] is True
    assert backend.calls[0][1:] == ("/api/v1/internal/semantic-model-assistant/models/m/sources/documents", "user-1", {
        "concept": "Contract", "workspaceId": "ws-1", "documentIds": ["d-1"], "folderIds": ["f-1"],
        "fields": {"Title": "document_name", "Amount": "ai"}, "keyFields": ["Contract number"],
    })


@pytest.mark.asyncio
async def test_read_tools_pass_queries_and_undo_targets_the_latest_change(monkeypatch, actor):
    backend = Recorder()
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        await client.call_tool("list_workspace_files", {"source_workspace_id": "ws 1", "search": "invoice 2024"})
        await client.call_tool("search_records", {"model_id": "m", "concept": "Invoice line", "query": "acme"})
        await client.call_tool("undo_model_change", {"model_id": "m"})
        await client.call_tool("undo_model_change", {"model_id": "m", "change_id": "c-1"})
    paths = [call[1] for call in backend.calls]
    assert paths == [
        "/api/v1/internal/semantic-model-assistant/workspaces/ws%201/files?search=invoice+2024",
        "/api/v1/internal/semantic-model-assistant/models/m/concepts/Invoice%20line/records?q=acme&limit=20",
        "/api/v1/internal/semantic-model-assistant/models/m/changes/undo",
        "/api/v1/internal/semantic-model-assistant/models/m/changes/c-1/undo",
    ]


@pytest.mark.asyncio
async def test_backend_errors_become_failure_envelopes(monkeypatch, actor):
    from clients.yellowstorm_semantic_model_client import SemanticModelBackendError

    class Failing:
        async def get(self, path, user_id):
            raise SemanticModelBackendError("ERR_3702", "Semantic model not found", 404)

    monkeypatch.setattr(server, "backend", lambda: Failing())
    async with Client(mcp) as client:
        result = result_dict(await client.call_tool("get_semantic_model", {"model_id": "missing"}))
    assert result["ok"] is False
    assert result["error"] == {"code": "ERR_3702", "message": "Semantic model not found", "retryable": False, "category": "not_found"}


@pytest.mark.asyncio
async def test_suggest_sources_sends_options_without_connecting_anything(monkeypatch, actor):
    backend = Recorder({"model": {"id": "m", "name": "Billing"}, "suggestions": []})
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        result = result_dict(await client.call_tool("suggest_sources", {
            "model_id": "Billing",
            "suggestions": '[{"concept": "Contract", "options": [{"source_workspace_id": "ws-1", "folder_ids": ["f-1"], "reason": "signed contracts"},'
                           ' {"source_workspace_id": "ws-2"}]}]',
        }))
    assert result["ok"] is True and result["meta"]["modelName"] == "Billing" and result["meta"]["modelId"] == "m"
    assert backend.calls == [("POST", "/api/v1/internal/semantic-model-assistant/models/Billing/source-suggestions", "user-1", {
        "suggestions": [{"concept": "Contract", "options": [
            {"workspaceId": "ws-1", "folderIds": ["f-1"], "reason": "signed contracts"}, {"workspaceId": "ws-2"},
        ]}],
    })]


@pytest.mark.asyncio
async def test_suggest_sources_refuses_an_option_without_a_workspace(monkeypatch, actor):
    backend = Recorder()
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        result = result_dict(await client.call_tool("suggest_sources", {"model_id": "m", "suggestions": [{"concept": "Contract", "options": [{}]}]}))
    assert result["ok"] is False and "source_workspace_id" in result["error"]["message"]
    assert backend.calls == []


@pytest.mark.asyncio
async def test_data_update_can_be_followed_and_stopped_without_an_id(monkeypatch, actor):
    backend = Recorder()
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        await client.call_tool("get_run_status", {"model_id": "m"})
        await client.call_tool("stop_data_update", {"model_id": "m"})
        await client.call_tool("stop_data_update", {"model_id": "m", "job_id": "job 1"})
    assert [(call[0], call[1]) for call in backend.calls] == [
        ("GET", "/api/v1/internal/semantic-model-assistant/models/m/runs/active"),
        ("POST", "/api/v1/internal/semantic-model-assistant/models/m/runs/stop"),
        ("POST", "/api/v1/internal/semantic-model-assistant/models/m/runs/job%201/stop"),
    ]
