import asyncio
from types import SimpleNamespace

from src.flow_engine.tools.langchain_factory import ToolResultCollector, _collect_connector_response_components
from src.smart_rag.tools.utilities.connector_tools import ConnectorToolContext, create_connector_tools
from src.web_citations import contains_exact_text, normalize_web_connector_response


def test_normalizes_provider_specific_search_results() -> None:
    response = normalize_web_connector_response(
        {"results": [{"name": "Result", "href": "https://example.com/a", "body": "Exact result text"}]},
        "web_search",
        "text_fragment",
        {"itemsPath": "results", "fields": {"title": ["name"], "url": ["href"], "snippet": ["body"]}},
        connector_id="connector-1",
        connector_slug="provider",
        action_key="search",
    )

    assert response["web_sources"] == [{
        "candidate_id": "wsc_1", "title": "Result", "url": "https://example.com/a", "snippet": "Exact result text",
    }]
    assert response["citation_sources"] == [{
        "type": "web", "source": "https://example.com/a", "title": "Result", "exact_text": "Exact result text",
        "evidence_origin": "search_snippet", "connector_id": "connector-1", "connector_slug": "provider", "action_key": "search",
    }]


def test_prefers_page_content_and_drops_invalid_or_duplicate_urls() -> None:
    response = normalize_web_connector_response(
        {"items": [
            {"title": "A", "url": "https://example.com/a", "content": "Page evidence"},
            {"title": "A duplicate", "url": "https://example.com/a", "content": "Page evidence"},
            {"title": "Unsafe", "url": "javascript:alert(1)", "content": "No"},
        ]},
        "web_search", "text_fragment", {},
    )
    assert len(response["web_sources"]) == 1
    assert response["citation_sources"][0]["exact_text"] == "Page evidence"
    assert response["citation_sources"][0]["evidence_origin"] == "page_content"


def test_exact_evidence_normalization_is_deterministic() -> None:
    assert contains_exact_text("Résultat\u00a0 net   en hausse.\r\nSuite", "Résultat net en hausse.")
    assert not contains_exact_text("Revenue decreased.", "Revenue increased.")
    assert not contains_exact_text("Revenue increased.", "")


def test_conversation_connector_registers_only_normalized_web_evidence(monkeypatch) -> None:
    async def fake_call_mcp_tool(*args, **kwargs):
        return {"results": [{"title": "A", "url": "https://example.com", "snippet": "Evidence"}], "citation_sources": [{"reference": "999"}]}

    monkeypatch.setattr("src.flow_engine.mcp.call_mcp_tool", fake_call_mcp_tool)
    binding = {
        "connector_id": "c1", "connector_name": "Search", "connector_slug": "search",
        "mcp_transport_type": "streamable_http", "mcp_server_url": "https://mcp.example.com",
        "actions": [{"action_key": "find", "parameter_schema": {}, "result_kind": "web_search", "citation_mode": "text_fragment"}],
    }
    tool = create_connector_tools([binding], ConnectorToolContext())[-1]
    context = SimpleNamespace(state={}, invocation_id="turn-1")
    response = asyncio.run(tool.func(tool_context=context))

    assert response["citation_sources"][0]["reference"] == "1"
    assert context.state["_connector_web_sources"][0]["object"]["content"]["exact_text"] == "Evidence"


def test_playbook_collector_emits_first_class_web_citation() -> None:
    collector = ToolResultCollector()
    response = normalize_web_connector_response(
        {"results": [{"title": "A", "url": "https://example.com", "snippet": "Evidence"}]},
        "web_search", "text_fragment", {},
    )
    normalized = _collect_connector_response_components(
        collector, response, tool_name="find", trusted_citations=True
    )

    assert normalized["citation_sources"][0]["reference"] == "[1]"
    assert collector.components == [{"type": "citation", "data": {
        "parent_id": "", "web_source": {
            "type": "web", "source": "https://example.com", "title": "A", "reference": "[1]",
            "exact_text": "Evidence", "prefix": "", "suffix": "", "evidence_origin": "search_snippet",
        },
    }}]
