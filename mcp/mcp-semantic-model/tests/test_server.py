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
        "find_records", "get_related_records", "describe_model", "query_records", "delete_semantic_model", "clone_semantic_model",
    }
    for tool in tools:
        assert tool.outputSchema["properties"]["schemaVersion"]["const"] == "semantic_model.mcp.v1"
        # ADK fills parameters named workspace_id with the chat's workspace; sources name theirs explicitly.
        assert "workspace_id" not in tool.inputSchema.get("properties", {}), tool.name
    hints = {tool.name: tool.annotations for tool in tools}
    assert hints["get_semantic_model"].readOnlyHint is True
    assert hints["publish_semantic_model"].destructiveHint is True
    assert hints["delete_semantic_model"].destructiveHint is True
    assert hints["find_records"].readOnlyHint is True
    assert hints["get_related_records"].readOnlyHint is True
    assert hints["describe_model"].readOnlyHint is True
    assert hints["query_records"].readOnlyHint is True


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


@pytest.mark.asyncio
async def test_find_records_searches_the_published_data_by_default(monkeypatch, actor):
    backend = Recorder({"model": {"id": "m", "name": "Billing"}, "status": "found", "records": [], "notes": []})
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        result = result_dict(await client.call_tool("find_records", {"model_id": "Billing", "query": " Acme contracts ", "concepts": '["Contract"]'}))
        await client.call_tool("find_records", {"model_id": "Billing", "query": "acme", "data": "draft", "limit": 3})
    assert result["ok"] is True and result["meta"]["modelName"] == "Billing"
    assert backend.calls == [
        ("POST", "/api/v1/internal/semantic-model-assistant/models/Billing/graph-search", "user-1",
         {"query": "Acme contracts", "concepts": ["Contract"], "data": "published", "limit": 10}),
        ("POST", "/api/v1/internal/semantic-model-assistant/models/Billing/graph-search", "user-1",
         {"query": "acme", "data": "draft", "limit": 3}),
    ]


@pytest.mark.asyncio
async def test_find_records_refuses_bad_input_without_calling_the_backend(monkeypatch, actor):
    backend = Recorder()
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        empty = result_dict(await client.call_tool("find_records", {"model_id": "m", "query": "  "}))
        data = result_dict(await client.call_tool("find_records", {"model_id": "m", "query": "x", "data": "production"}))
        limit = result_dict(await client.call_tool("find_records", {"model_id": "m", "query": "x", "limit": 26}))
    assert empty["ok"] is False and "query" in empty["error"]["message"]
    assert data["ok"] is False and "published, draft" in data["error"]["message"]
    assert limit["ok"] is False and "limit" in limit["error"]["message"]
    assert backend.calls == []


@pytest.mark.asyncio
async def test_get_related_records_builds_one_or_two_steps(monkeypatch, actor):
    backend = Recorder({"status": "found", "truncated": False, "records": [], "links": [], "notes": []})
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        await client.call_tool("get_related_records", {"model_id": "m", "record_ids": ["e-1"]})
        await client.call_tool("get_related_records", {
            "model_id": "m", "record_ids": '["e-1", "e-2"]', "relations": ["signs"], "direction": "outgoing",
            "then_relations": ["is billed by"], "concepts": ["Invoice"], "data": "draft", "max_records": 20,
        })
    assert backend.calls == [
        ("POST", "/api/v1/internal/semantic-model-assistant/models/m/graph-expand", "user-1",
         {"recordIds": ["e-1"], "direction": "both", "data": "published", "maxRecords": 50}),
        ("POST", "/api/v1/internal/semantic-model-assistant/models/m/graph-expand", "user-1",
         {"recordIds": ["e-1", "e-2"], "relations": ["signs"], "direction": "outgoing", "thenRelations": ["is billed by"],
          "concepts": ["Invoice"], "data": "draft", "maxRecords": 20}),
    ]


@pytest.mark.asyncio
async def test_get_related_records_refuses_bad_input_without_calling_the_backend(monkeypatch, actor):
    backend = Recorder()
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        none = result_dict(await client.call_tool("get_related_records", {"model_id": "m", "record_ids": []}))
        many = result_dict(await client.call_tool("get_related_records", {"model_id": "m", "record_ids": [f"e-{i}" for i in range(26)]}))
        direction = result_dict(await client.call_tool("get_related_records", {"model_id": "m", "record_ids": ["e-1"], "direction": "up"}))
        cap = result_dict(await client.call_tool("get_related_records", {"model_id": "m", "record_ids": ["e-1"], "max_records": 0}))
    assert none["ok"] is False and "record_ids" in none["error"]["message"]
    assert many["ok"] is False and "record_ids" in many["error"]["message"]
    assert direction["ok"] is False and "direction" in direction["error"]["message"]
    assert cap["ok"] is False and "max_records" in cap["error"]["message"]
    assert backend.calls == []


@pytest.mark.asyncio
async def test_record_search_tools_tell_the_agent_how_to_read_results():
    async with Client(mcp) as client:
        tools = {tool.name: tool for tool in await client.list_tools()}
    find = tools["find_records"].description
    related = tools["get_related_records"].description
    assert "NOT documents" in find and "index_not_ready" in find and "not_represented" in find and "Never infer" in find
    assert "get_related_records" in find
    assert "NOT because it matched" in related and "truncated" in related and "find_records" in related and "Never infer" in related


@pytest.mark.asyncio
async def test_describe_model_reads_the_published_data_by_default(monkeypatch, actor):
    backend = Recorder({"model": {"id": "m", "name": "Mail"}, "concepts": [], "relations": [], "notes": []})
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        await client.call_tool("describe_model", {"model_id": "Mail archive"})
        await client.call_tool("describe_model", {"model_id": "m", "data": "draft"})
        bad = result_dict(await client.call_tool("describe_model", {"model_id": "m", "data": "live"}))
    assert [call[1] for call in backend.calls] == [
        "/api/v1/internal/semantic-model-assistant/models/Mail%20archive/data-description?data=published",
        "/api/v1/internal/semantic-model-assistant/models/m/data-description?data=draft",
    ]
    assert bad["ok"] is False and "data" in bad["error"]["message"]


@pytest.mark.asyncio
async def test_query_records_sends_one_structured_query(monkeypatch, actor):
    backend = Recorder({"model": {"id": "m", "name": "Mail"}, "status": "ok", "total": 3, "groups": [], "notes": []})
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        result = result_dict(await client.call_tool("query_records", {
            "model_id": "Mail", "concept": " Message ",
            "filters": '[{"field": "Received", "op": "between", "value": "last_3_months"}, {"field": "sent by.domain", "op": "eq", "value": "acme.com"},'
                       ' {"field": "Attachments", "op": "not_empty", "value": null}, {"field": "Paid", "op": "eq", "value": false}]',
            "group_by": ["Sender", {"field": "Received", "bucket": "month"}],
            "aggregates": ["count", {"op": "count_distinct", "field": "Sender"}],
            "order_by": [{"field": "count", "direction": "desc"}], "limit": 0, "match": "any",
        }))
        await client.call_tool("query_records", {"model_id": "Mail", "concept": "Message", "fields": '["Subject"]', "offset": 50, "data": "draft"})
    assert result["ok"] is True
    assert backend.calls == [
        ("POST", "/api/v1/internal/semantic-model-assistant/models/Mail/records-query", "user-1", {
            "concept": "Message",
            "filters": [{"field": "Received", "op": "between", "value": "last_3_months"}, {"field": "sent by.domain", "op": "eq", "value": "acme.com"},
                        {"field": "Attachments", "op": "not_empty"}, {"field": "Paid", "op": "eq", "value": False}],
            "match": "any",
            "groupBy": [{"field": "Sender"}, {"field": "Received", "bucket": "month"}],
            "aggregates": [{"op": "count"}, {"op": "count_distinct", "field": "Sender"}],
            "orderBy": [{"field": "count", "direction": "desc"}],
            "limit": 0, "offset": 0, "data": "published",
        }),
        ("POST", "/api/v1/internal/semantic-model-assistant/models/Mail/records-query", "user-1",
         {"concept": "Message", "match": "all", "fields": ["Subject"], "limit": 50, "offset": 50, "data": "draft"}),
    ]


@pytest.mark.asyncio
async def test_query_records_refuses_bad_input_without_calling_the_backend(monkeypatch, actor):
    backend = Recorder()
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        outcomes = [result_dict(await client.call_tool("query_records", {"model_id": "m", **arguments})) for arguments in (
            {"concept": "  "},
            {"concept": "X", "filters": '[{"field": "a"}]'},
            {"concept": "X", "filters": "not json"},
            {"concept": "X", "group_by": [42]},
            {"concept": "X", "limit": 201},
            {"concept": "X", "offset": -1},
            {"concept": "X", "match": "some"},
            {"concept": "X", "data": "production"},
        )]
    assert all(outcome["ok"] is False and outcome["error"]["category"] == "validation" for outcome in outcomes)
    assert backend.calls == []


@pytest.mark.asyncio
async def test_data_tools_tell_the_agent_when_to_use_them_and_how_to_report():
    async with Client(mcp) as client:
        tools = {tool.name: tool for tool in await client.list_tools()}
    query = tools["query_records"].description
    describe = tools["describe_model"].description
    assert "exact totals" in query and "last_N_days" in query and "<relation>.<field>" in query
    assert "invalid_query" in query and "appliedQuery" in query and "unparsable" in query and "nextOffset" in query
    assert "first" in describe and "type" in describe and "inData" in describe
    assert "describe_model first" in server.INSTRUCTIONS and "query_records" in server.INSTRUCTIONS
    assert "Never invent" in server.INSTRUCTIONS and "cite the records" in server.INSTRUCTIONS


@pytest.mark.asyncio
async def test_delete_semantic_model_passes_the_confirmed_name(monkeypatch, actor):
    backend = Recorder({"deleted": True})
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        response = await client.call_tool("delete_semantic_model", {"model_id": "m/1", "confirm_name": "Billing models"})
    assert result_dict(response)["ok"] is True
    assert backend.calls == [("DELETE", "/api/v1/internal/semantic-model-assistant/models/m%2F1?confirmName=Billing+models", "user-1", None)]


@pytest.mark.asyncio
async def test_clone_semantic_model_sends_the_include_options(monkeypatch, actor):
    backend = Recorder({"modelId": "copy-1"})
    monkeypatch.setattr(server, "backend", lambda: backend)
    async with Client(mcp) as client:
        response = await client.call_tool("clone_semantic_model", {"model_id": "m/1", "include_data": True})
    assert result_dict(response)["ok"] is True
    assert backend.calls == [("POST", "/api/v1/internal/semantic-model-assistant/models/m%2F1/clone", "user-1",
                              {"includeSources": True, "includeData": True, "includeShares": False})]
