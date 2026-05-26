import asyncio
import sys
from types import SimpleNamespace

import pytest

sys.modules.setdefault(
    "src.smart_rag.tools.utilities.connector_tools",
    SimpleNamespace(import_connector_items_to_workspace_request=lambda *args, **kwargs: None),
)

from src.flow_engine.tools.langchain_factory import (
    ToolResultCollector,
    _collect_connector_response_components,
    _create_code_interpreter_tool,
    _create_connector_mcp_tools,
    _select_generated_artifact_output_port,
)
from src.flow_engine.nodes.step_tools import _tool_to_openai_definition


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


def test_select_generated_artifact_output_port_falls_back_to_single_file_port() -> None:
    selected_port = _select_generated_artifact_output_port(
        [
            {"id": "summary", "artifact_kind": "text"},
            {"id": "report", "name": "Report", "artifact_kind": "document"},
        ],
        "iteration_summary.xlsx",
        "data",
    )

    assert selected_port == {
        "id": "report",
        "name": "Report",
        "artifact_kind": "document",
    }


def test_select_generated_artifact_output_port_matches_filename_to_port_name() -> None:
    selected_port = _select_generated_artifact_output_port(
        [
            {"id": "attestation", "name": "Attestation", "artifact_kind": "document"},
            {"id": "summary", "name": "Summary", "artifact_kind": "document"},
        ],
        "attestation_synthese.pdf",
        "document",
    )

    assert selected_port == {
        "id": "attestation",
        "name": "Attestation",
        "artifact_kind": "document",
    }


def test_select_generated_artifact_output_port_falls_back_to_default_port() -> None:
    selected_port = _select_generated_artifact_output_port(
        [
            {"id": "default", "name": "Default", "artifact_kind": "document"},
            {"id": "secondary", "name": "Secondary", "artifact_kind": "document"},
        ],
        "random_file.pdf",
        "document",
    )

    assert selected_port == {
        "id": "default",
        "name": "Default",
        "artifact_kind": "document",
    }


def test_code_interpreter_generated_xlsx_emits_explicit_output_port(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "stdout": "ok",
                "stderr": "",
                "time": 1,
                "status": {"id": 3, "description": "ok"},
                "generated_files": [
                    {
                        "azure_path": "https://example.com/iteration_summary.xlsx",
                        "filename": "iteration_summary.xlsx",
                    }
                ],
            }

    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(CODE_INTERPRETER_BACKEND_URL="https://sandbox.test"),
    )
    monkeypatch.setattr("requests.post", lambda *args, **kwargs: FakeResponse())

    collector = ToolResultCollector()
    tool = _create_code_interpreter_tool(
        {
            "agent_params": {
                "session_id": "session-1",
                "user_id": "user-1",
            }
        },
        brain_ids=["workspace-1"],
        code_interpreter_files=[],
        collector=collector,
        output_ports=[
            {"id": "summary", "artifact_kind": "text"},
            {"id": "report", "name": "Report", "artifact_kind": "document"},
        ],
        documents_by_port={},
        output_workspace_id="workspace-1",
        workspace_context_mode="resolved_inputs_only",
    )

    assert tool is not None
    asyncio.run(tool.ainvoke({"code": "print('ok')", "timeout_seconds": 5}))
    components = collector.get_and_clear()

    assert components[1] == {
        "type": "artifact",
        "data": {
            "file_path": "https://example.com/iteration_summary.xlsx",
            "filename": "iteration_summary.xlsx",
            "artifact_kind": "document",
            "output_port_id": "report",
        },
    }


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
        "src.flow_engine.mcp.call_mcp_tool",
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

    search_tool = next(
        tool
        for tool in tools
        if tool.name == "sharepoint_searchv2_search_document_blocks"
    )
    result = asyncio.run(search_tool.ainvoke({"params": {"query": "revenue"}}))
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
        "src.flow_engine.mcp.call_mcp_tool",
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

    search_tool = next(
        tool
        for tool in tools
        if tool.name == "sharepoint_searchv2_search_document_blocks"
    )
    result = asyncio.run(search_tool.ainvoke({"params": {"query": "revenue"}}))

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
        "src.flow_engine.mcp.call_mcp_tool",
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

    search_tool = next(
        tool
        for tool in tools
        if tool.name == "sharepoint_searchv2_search_document_blocks"
    )
    asyncio.run(search_tool.ainvoke({"params": {"query": "revenue"}}))

    assert captured["auth_headers"] == {
        "Authorization": "Bearer token",
        "X-Custom-Header": "custom-value",
    }


def test_connector_mcp_tool_definition_exposes_params_when_schema_is_missing() -> None:
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

    search_tool = next(
        tool
        for tool in tools
        if tool.name == "sharepoint_searchv2_search_document_blocks"
    )
    definition = _tool_to_openai_definition(search_tool)

    assert definition["function"]["parameters"]["properties"]["params"]["type"] == "object"
