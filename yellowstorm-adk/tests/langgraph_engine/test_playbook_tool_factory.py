import asyncio

import pytest

from src.langgraph_engine.playbook_tool_factory import (
    ToolResultCollector,
    _collect_connector_response_components,
    _create_connector_mcp_tools,
)


def test_collect_connector_response_components_emits_sources_and_citations() -> None:
    collector = ToolResultCollector()
    response = {
        "text": "Quarterly revenue increased by 18%.",
        "sources": [
            {
                "title": "Q1-report.txt",
                "url": "https://contoso.sharepoint.com/q1-report.txt",
            }
        ],
        "citation_sources": [
            {
                "type": "text",
                "source": "Q1-report.txt",
                "external_id": "item-123",
                "page": "2",
                "page_content": "Quarterly revenue increased by 18%.",
                "workspace_id": "workspace-1",
                "reference": "",
            }
        ],
    }

    updated = _collect_connector_response_components(collector, response)
    components = collector.get_and_clear()

    assert "Use citation [1]" in updated["text"]
    assert updated["citation_sources"][0]["reference"] == "1"
    assert components == [
        {
            "type": "sources",
            "data": {
                "sources": [
                    {
                        "title": "Q1-report.txt",
                        "url": "https://contoso.sharepoint.com/q1-report.txt",
                    }
                ]
            },
        },
        {
            "type": "citation",
            "data": {
                "parent_id": "",
                "text_source": {
                    "type": "text",
                    "source": "Q1-report.txt",
                    "external_id": "item-123",
                    "page": "2",
                    "page_content": "Quarterly revenue increased by 18%.",
                    "workspace_id": "workspace-1",
                    "reference": "1",
                },
            },
        },
    ]


def test_collect_connector_response_components_reuses_connector_references() -> None:
    collector = ToolResultCollector()
    response = {
        "text": "Quarterly revenue increased by 18%.",
        "citation_sources": [
            {
                "type": "text",
                "source": "Q1-report.txt",
                "external_id": "item-123",
                "page": "2",
                "page_content": "Quarterly revenue increased by 18%.",
                "workspace_id": "workspace-1",
                "reference": "",
            }
        ],
    }

    first = _collect_connector_response_components(collector, response)
    first_components = collector.get_and_clear()
    second = _collect_connector_response_components(collector, response)
    second_components = collector.get_and_clear()

    assert first["citation_sources"][0]["reference"] == "1"
    assert second["citation_sources"][0]["reference"] == "1"
    assert len(first_components) == 1
    assert second_components == []


def test_collector_seed_continues_references_and_reuses_prior_citations() -> None:
    collector = ToolResultCollector(
        initial_components=[
            {
                "type": "citation",
                "data": {
                    "parent_id": "step-1-text",
                    "text_source": {
                        "type": "text",
                        "source": "Doc 1",
                        "external_id": "doc-1",
                        "page": "1",
                        "page_content": "Existing evidence",
                        "workspace_id": "workspace-1",
                        "reference": "5",
                    },
                },
            }
        ]
    )

    reused = _collect_connector_response_components(
        collector,
        {
            "text": "Existing evidence",
            "citation_sources": [
                {
                    "type": "text",
                    "source": "Doc 1",
                    "external_id": "doc-1",
                    "page": "1",
                    "page_content": "Existing evidence",
                    "workspace_id": "workspace-1",
                    "reference": "",
                }
            ],
        },
    )
    reused_components = collector.get_and_clear()

    fresh = _collect_connector_response_components(
        collector,
        {
            "text": "New evidence",
            "citation_sources": [
                {
                    "type": "text",
                    "source": "Doc 2",
                    "external_id": "doc-2",
                    "page": "3",
                    "page_content": "New evidence",
                    "workspace_id": "workspace-1",
                    "reference": "",
                }
            ],
        },
    )

    assert reused["citation_sources"][0]["reference"] == "5"
    assert reused_components == []
    assert fresh["citation_sources"][0]["reference"] == "6"


def test_connector_mcp_tools_emit_citation_components(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_call_mcp_tool(*args, **kwargs):
        return {
            "text": "Quarterly revenue increased by 18%.",
            "citation_sources": [
                {
                    "type": "text",
                    "source": "Q1-report.txt",
                    "external_id": "item-123",
                    "page": "2",
                    "page_content": "Quarterly revenue increased by 18%.",
                    "workspace_id": "workspace-1",
                    "reference": "",
                }
            ],
        }

    monkeypatch.setattr(
        "src.langgraph_engine.mcp_client_factory.call_mcp_tool",
        fake_call_mcp_tool,
    )

    collector = ToolResultCollector()
    tools = _create_connector_mcp_tools(
        [
            {
                "connector_id": "connector-1",
                "connector_name": "SharePoint",
                "connector_slug": "sharepoint",
                "mcp_transport_type": "streamable_http",
                "mcp_server_url": "https://example.com/mcp",
                "actions": [
                    {
                        "action_key": "searchv2_search_document_blocks",
                        "label": "Search",
                        "description": "Search documents",
                    }
                ],
            }
        ],
        collector,
    )

    result = asyncio.run(tools[0].ainvoke({"query": "revenue"}))
    components = collector.get_and_clear()

    assert "Use citation [1]" in result["text"]
    assert components == [
        {
            "type": "citation",
            "data": {
                "parent_id": "",
                "text_source": {
                    "type": "text",
                    "source": "Q1-report.txt",
                    "external_id": "item-123",
                    "page": "2",
                    "page_content": "Quarterly revenue increased by 18%.",
                    "workspace_id": "workspace-1",
                    "reference": "1",
                },
            },
        }
    ]


def test_connector_mcp_tools_do_not_inject_workspace_or_external_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["auth_headers"] = kwargs.get("auth_headers")
        captured["auth_env"] = kwargs.get("auth_env")
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.langgraph_engine.mcp_client_factory.call_mcp_tool",
        fake_call_mcp_tool,
    )

    collector = ToolResultCollector()
    tools = _create_connector_mcp_tools(
        [
            {
                "connector_id": "connector-1",
                "connector_name": "SharePoint",
                "connector_slug": "sharepoint",
                "mcp_transport_type": "streamable_http",
                "mcp_server_url": "https://example.com/mcp",
                "auth_headers": {
                    "Authorization": "Bearer token",
                },
                "actions": [
                    {
                        "action_key": "searchv2_search_document_blocks",
                        "label": "Search",
                        "description": "Search documents",
                    }
                ],
            }
        ],
        collector,
        output_workspace_id="playbook-workspace-1",
        brain_ids=["agent-brain-1", "agent-brain-2"],
        external_ids=["doc-1", "doc-2"],
    )

    result = asyncio.run(tools[0].ainvoke({"query": "revenue"}))

    assert result == {"text": "ok"}
    assert captured["params"] == {"query": "revenue"}
    assert captured["auth_env"] == {}
    assert captured["auth_headers"] == {"Authorization": "Bearer token"}


def test_connector_mcp_tools_preserve_explicit_auth_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["auth_headers"] = kwargs.get("auth_headers")
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.langgraph_engine.mcp_client_factory.call_mcp_tool",
        fake_call_mcp_tool,
    )

    collector = ToolResultCollector()
    tools = _create_connector_mcp_tools(
        [
            {
                "connector_id": "connector-1",
                "connector_name": "SharePoint",
                "connector_slug": "sharepoint",
                "mcp_transport_type": "streamable_http",
                "mcp_server_url": "https://example.com/mcp",
                "auth_headers": {
                    "Authorization": "Bearer token",
                    "X-Custom-Header": "custom-value",
                },
                "actions": [
                    {
                        "action_key": "searchv2_search_document_blocks",
                        "label": "Search",
                        "description": "Search documents",
                    }
                ],
            }
        ],
        collector,
        output_workspace_id="",
        brain_ids=["agent-brain-1"],
    )

    asyncio.run(tools[0].ainvoke({"query": "revenue"}))

    assert captured["auth_headers"] == {
        "Authorization": "Bearer token",
        "X-Custom-Header": "custom-value",
    }
