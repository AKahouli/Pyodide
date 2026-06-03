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
    _create_search_tools,
    _select_generated_artifact_output_port,
    _format_search_result,
)
from src.smart_rag.tools.utilities.code_interpreter_payload import (
    build_code_interpreter_payload_context,
)
from src.smart_rag.tools.utilities.code_interpreter import python_interpreter
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
                "file_name": "item-123",
                "page": "2",
                "page_content": "Quarterly revenue increased by 18%.",
                "workspace_id": "workspace-1",
                "workspace_name": "",
                "reference": "",
            }
        ],
    }

    updated = _collect_connector_response_components(collector, response)
    components = collector.get_and_clear()

    assert "Use citation [1]" in updated["text"]
    assert updated["citation_sources"][0]["reference"] == "[1]"
    assert updated["citation_sources"][0]["workspace_name"] == "workspace-1"
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
                    "file_name": "item-123",
                    "page": "2",
                    "page_content": "Quarterly revenue increased by 18%.",
                    "workspace_id": "workspace-1",
                    "workspace_name": "workspace-1",
                    "reference": "[1]",
                },
            },
        },
    ]


def test_playbook_filtered_search_uses_qdrant_metadata_filters(monkeypatch) -> None:
    captured_filters = []

    def capture_payload(self, query, filter_params, vectorstore, top_k, search_type, user_id=None):
        captured_filters.append(dict(filter_params))
        return {"filter": filter_params}

    async def post_vectorstore(self, token, payload):
        return []

    monkeypatch.setattr(
        "src.smart_rag.tools.infrastructure.common_helpers.CommonHelpers.create_search_payload",
        capture_payload,
    )
    monkeypatch.setattr(
        "src.smart_rag.tools.infrastructure.common_helpers.CommonHelpers.post_vectorstore",
        post_vectorstore,
    )

    tools = _create_search_tools(
        tool_configs=[{"name": "search"}],
        doc_tree=[],
        brain_tree=[],
        workspace_names=["workspace-1"],
        top_k=4,
        collector=ToolResultCollector(),
        file_names=["report.pdf"],
        user_id="user-1",
    )

    search_tool = next(tool for tool in tools if tool.name == "perform_filtered_search")
    asyncio.run(search_tool.ainvoke({"query": "revenue"}))

    assert captured_filters
    assert all(item["workspace_id"] == ["workspace-1"] for item in captured_filters)
    assert all(item["file_name"] == "report.pdf" for item in captured_filters)
    assert all(item["user_id"] == "user-1" for item in captured_filters)
    assert all("workspace_name" not in item for item in captured_filters)
    assert all("brain_id" not in item for item in captured_filters)
    assert all("external_id" not in item for item in captured_filters)


def test_format_search_result_includes_search_tool_citation_reference() -> None:
    result = {
        "sources_text": [
            {
                "page_content": "Quarterly revenue increased by 18%.",
                "filename": "Q1-report.txt",
                "source_reference": "[1]",
            }
        ],
        "sources_image": [],
    }

    formatted = _format_search_result(result)

    assert "[Source 1: Q1-report.txt | Citation: [1]]" in formatted
    assert "Quarterly revenue increased by 18%." in formatted


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
    captured_request = {}

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

    def _fake_post(*args, **kwargs):
        captured_request.update(kwargs.get("json", {}))
        return FakeResponse()

    monkeypatch.setattr("requests.post", _fake_post)

    collector = ToolResultCollector()
    tool = _create_code_interpreter_tool(
        {
            "agent_params": {
                "session_id": "session-1",
                "user_id": "user-1",
            }
        },
        workspace_names=["workspace-1"],
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

    assert captured_request == {
        "user_id": "user-1",
        "workspace_name": "workspace-1",
        "session_id": "session-1",
        "code": "print('ok')",
        "timeout_seconds": 5,
        "file_names": [],
    }
    assert components[1] == {
        "type": "artifact",
        "data": {
            "file_path": "https://example.com/iteration_summary.xlsx",
            "filename": "iteration_summary.xlsx",
            "artifact_kind": "document",
            "output_port_id": "report",
        },
    }


def test_code_interpreter_generated_file_uses_object_key_fallback(
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
                        "object_key": "user/session/report.xlsx",
                        "filename": "report.xlsx",
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
        workspace_names=["workspace-1"],
        code_interpreter_files=[],
        collector=collector,
        output_ports=[{"id": "default", "artifact_kind": "document"}],
        documents_by_port={},
        output_workspace_id="workspace-1",
        workspace_context_mode="resolved_inputs_only",
    )

    assert tool is not None
    asyncio.run(tool.ainvoke({"code": "print('ok')", "timeout_seconds": 5}))

    artifact = collector.get_and_clear()[1]
    assert artifact["data"]["file_path"] == "user/session/report.xlsx"
    assert artifact["data"]["object_key"] == "user/session/report.xlsx"


def test_code_interpreter_request_normalizes_prefixed_workspace_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_request = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "stdout": "ok",
                "stderr": "",
                "time": 1,
                "status": {"id": 3, "description": "ok"},
                "generated_files": [],
            }

    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(CODE_INTERPRETER_BACKEND_URL="https://sandbox.test"),
    )

    def _fake_post(*args, **kwargs):
        captured_request.update(kwargs.get("json", {}))
        return FakeResponse()

    monkeypatch.setattr("requests.post", _fake_post)

    collector = ToolResultCollector()
    tool = _create_code_interpreter_tool(
        {
            "agent_params": {
                "session_id": "session-1",
                "user_id": "user-1",
            }
        },
        workspace_names=["workspace-1"],
        code_interpreter_files=[
            {
                "filepath": "owner-123/workspace-prefix/report.csv",
                "filename": "report.csv",
                "workspace_id": "workspace-1",
                "workspace_name": "owner-123/workspace-prefix",
            }
        ],
        collector=collector,
        output_ports=[],
        documents_by_port={},
        output_workspace_id="workspace-1",
        workspace_context_mode="resolved_inputs_only",
    )

    assert tool is not None
    asyncio.run(tool.ainvoke({"code": "print('ok')", "timeout_seconds": 5}))

    assert captured_request == {
        "user_id": "user-1",
        "workspace_name": "workspace-prefix",
        "session_id": "session-1",
        "code": "print('ok')",
        "timeout_seconds": 5,
        "file_names": ["report.csv"],
    }


def test_build_code_interpreter_payload_context_uses_common_parent_prefix() -> None:
    workspace_name, file_names, skipped_files, mixed_workspace_files = build_code_interpreter_payload_context(
        [
            {
                "filepath": "owner-1/ws-default/A.docx",
                "filename": "A.docx",
                "workspace_id": "ws-default",
                "workspace_name": "owner-1/ws-default",
            },
            {
                "filepath": "owner-1/ws-default/B.docx",
                "filename": "B.docx",
                "workspace_id": "ws-default",
                "workspace_name": "owner-1/ws-default",
            },
        ],
        owner_user_id="owner-1",
    )

    assert workspace_name == "ws-default"
    assert file_names == ["A.docx", "B.docx"]
    assert skipped_files == []
    assert mixed_workspace_files == []


def test_build_code_interpreter_payload_context_reuses_fallback_for_generated_urls() -> None:
    workspace_name, file_names, skipped_files, mixed_workspace_files = build_code_interpreter_payload_context(
        [
            {
                "filepath": "owner-123/workspace-prefix/report.csv",
                "filename": "report.csv",
                "workspace_id": "workspace-1",
                "workspace_name": "owner-123/workspace-prefix",
            },
            {
                "filepath": "https://example.com/generated/chart.png",
                "filename": "chart.png",
                "workspace_id": "workspace-1",
                "workspace_name": "",
            },
        ],
        fallback_workspace_name="owner-123/workspace-prefix",
        owner_user_id="owner-123",
    )

    assert workspace_name == "workspace-prefix"
    assert file_names == ["report.csv", "chart.png"]
    assert skipped_files == []
    assert mixed_workspace_files == []


def test_build_code_interpreter_payload_context_skips_blank_id_conflict() -> None:
    workspace_name, file_names, skipped_files, mixed_workspace_files = build_code_interpreter_payload_context(
        [
            {
                "filepath": "owner-a/ws-a/A.docx",
                "filename": "A.docx",
                "workspace_id": "ws-a",
                "workspace_name": "owner-a/ws-a",
            },
            {
                "filepath": "owner-b/ws-b/B.docx",
                "filename": "B.docx",
                "workspace_id": "",
                "workspace_name": "owner-b/ws-b",
            },
        ],
        fallback_workspace_name="owner-a/ws-a",
        selected_workspace_id="ws-a",
        owner_user_id="owner-a",
    )

    assert workspace_name == "ws-a"
    assert file_names == ["A.docx"]
    assert skipped_files == []
    assert mixed_workspace_files == ["B.docx"]


def test_build_code_interpreter_payload_context_keeps_blank_id_files_from_same_path_workspace() -> None:
    workspace_name, file_names, skipped_files, mixed_workspace_files = build_code_interpreter_payload_context(
        [
            {
                "filepath": "owner-a/ws-a/A.docx",
                "filename": "A.docx",
                "workspace_id": "",
                "workspace_name": "",
            },
        ],
        fallback_workspace_name="ws-output",
        selected_workspace_id="ws-a",
        owner_user_id="owner-a",
    )

    assert workspace_name == "ws-a"
    assert file_names == ["A.docx"]
    assert skipped_files == []
    assert mixed_workspace_files == []


def test_build_code_interpreter_payload_context_keeps_legacy_non_prefixed_path() -> None:
    workspace_name, file_names, skipped_files, mixed_workspace_files = build_code_interpreter_payload_context(
        [
            {
                "filepath": "workspace/documents/slides.pptx",
                "filename": "slides.pptx",
                "workspace_id": "ws-1",
                "workspace_name": "",
            },
        ],
        fallback_workspace_name="ws-1",
        selected_workspace_id="ws-1",
        owner_user_id="owner-123",
    )

    assert workspace_name == "workspace"
    assert file_names == ["slides.pptx"]
    assert skipped_files == []
    assert mixed_workspace_files == []


def test_code_interpreter_description_lists_only_mounted_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(CODE_INTERPRETER_BACKEND_URL="https://sandbox.test"),
    )

    collector = ToolResultCollector()
    tool = _create_code_interpreter_tool(
        {
            "agent_params": {
                "session_id": "session-1",
                "user_id": "owner-a",
            }
        },
        workspace_names=["ws-a"],
        code_interpreter_files=[
            {
                "filepath": "owner-a/ws-a/A.docx",
                "filename": "A.docx",
                "workspace_id": "ws-a",
                "workspace_name": "owner-a/ws-a",
            },
            {
                "filepath": "owner-b/ws-b/B.docx",
                "filename": "B.docx",
                "workspace_id": "ws-b",
                "workspace_name": "owner-b/ws-b",
            },
        ],
        collector=collector,
        output_ports=[],
        documents_by_port={},
        output_workspace_id="ws-a",
        workspace_context_mode="resolved_inputs_only",
    )

    assert tool is not None
    assert "A.docx" in tool.description
    assert "B.docx" not in tool.description


def test_python_interpreter_reuses_workspace_name_for_generated_follow_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_requests = []

    class FakeResponse:
        def __init__(self, generated_files: list[dict]) -> None:
            self._generated_files = generated_files

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "stdout": "ok",
                "stderr": "",
                "time": 1,
                "status": {"id": 3, "description": "ok"},
                "generated_files": self._generated_files,
            }

    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(CODE_INTERPRETER_BACKEND_URL="https://sandbox.test"),
    )

    def _fake_post(*args, **kwargs):
        payload = kwargs.get("json", {})
        captured_requests.append(payload)
        if len(captured_requests) == 1:
            return FakeResponse(
                [
                    {
                        "name": "chart.png",
                        "azure_path": "https://example.com/generated/chart.png",
                    }
                ]
            )
        return FakeResponse([])

    monkeypatch.setattr("requests.post", _fake_post)

    tool_context = SimpleNamespace(
        state={
            "_code_interpreter_session_id": "session-1",
            "_code_interpreter_brain_id": "workspace-1",
            "_code_interpreter_user_id": "user-1",
            "_code_interpreter_brain_docs": [
                {
                    "filename": "report.csv",
                    "filepath": "owner-123/workspace-prefix/report.csv",
                    "workspace_id": "workspace-1",
                }
            ],
            "_code_interpreter_generated_files": [],
        }
    )

    asyncio.run(python_interpreter("print('first')", timeout_seconds=5, tool_context=tool_context))

    assert tool_context.state["_code_interpreter_generated_files"][0]["workspace_name"] == "workspace-prefix"
    assert tool_context.state["_code_interpreter_brain_docs"][-1]["workspace_name"] == "workspace-prefix"

    tool_context.state["_code_interpreter_brain_docs"] = [
        {
            "filename": "chart.png",
            "filepath": "https://example.com/generated/chart.png",
            "workspace_id": "workspace-1",
            "workspace_name": "workspace-prefix",
        }
    ]

    asyncio.run(python_interpreter("print('second')", timeout_seconds=5, tool_context=tool_context))

    assert captured_requests[0]["workspace_name"] == "workspace-prefix"
    assert captured_requests[1]["workspace_name"] == "workspace-prefix"


def test_python_interpreter_reuses_generated_file_workspace_name_without_brain_docs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_requests = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "stdout": "ok",
                "stderr": "",
                "time": 1,
                "status": {"id": 3, "description": "ok"},
                "generated_files": [],
            }

    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(CODE_INTERPRETER_BACKEND_URL="https://sandbox.test"),
    )

    def _fake_post(*args, **kwargs):
        captured_requests.append(kwargs.get("json", {}))
        return FakeResponse()

    monkeypatch.setattr("requests.post", _fake_post)

    tool_context = SimpleNamespace(
        state={
            "_code_interpreter_session_id": "session-1",
            "_code_interpreter_brain_id": "workspace-1",
            "_code_interpreter_user_id": "user-1",
            "_code_interpreter_brain_docs": [],
            "_code_interpreter_generated_files": [
                {
                    "filename": "chart.png",
                    "azure_path": "https://example.com/generated/chart.png",
                    "workspace_id": "workspace-1",
                    "workspace_name": "workspace-prefix",
                }
            ],
        }
    )

    asyncio.run(python_interpreter("print('second')", timeout_seconds=5, tool_context=tool_context))

    assert captured_requests[0]["workspace_name"] == "workspace-prefix"
    assert captured_requests[0]["file_names"] == ["chart.png"]


def test_build_code_interpreter_payload_context_skips_other_workspace_files() -> None:
    workspace_name, file_names, skipped_files, mixed_workspace_files = build_code_interpreter_payload_context(
        [
            {
                "filepath": "owner-a/ws-a/A.docx",
                "filename": "A.docx",
                "workspace_id": "ws-a",
                "workspace_name": "owner-a/ws-a",
            },
            {
                "filepath": "owner-b/ws-b/B.docx",
                "filename": "B.docx",
                "workspace_id": "ws-b",
                "workspace_name": "owner-b/ws-b",
            },
        ],
        fallback_workspace_name="",
    )

    assert workspace_name == ""
    assert file_names == []
    assert skipped_files == []
    assert mixed_workspace_files == ["A.docx", "B.docx"]


def test_collect_connector_response_components_reuses_connector_references() -> None:
    collector = ToolResultCollector()
    response = {
        "text": "Quarterly revenue increased by 18%.",
        "citation_sources": [
            {
                "type": "text",
                "source": "Q1-report.txt",
                "file_name": "item-123",
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

    assert first["citation_sources"][0]["reference"] == "[1]"
    assert second["citation_sources"][0]["reference"] == "[1]"
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
                        "file_name": "doc-1",
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
                    "file_name": "doc-1",
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
                    "file_name": "doc-2",
                    "page": "3",
                    "page_content": "New evidence",
                    "workspace_id": "workspace-1",
                    "reference": "",
                }
            ],
        },
    )

    assert reused["citation_sources"][0]["reference"] == "[5]"
    assert reused_components == []
    assert fresh["citation_sources"][0]["reference"] == "[6]"


def test_connector_mcp_tools_emit_citation_components(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_call_mcp_tool(*args, **kwargs):
        return {
            "text": "Quarterly revenue increased by 18%.",
            "citation_sources": [
                {
                    "type": "text",
                    "source": "Q1-report.txt",
                    "file_name": "item-123",
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
                    "file_name": "item-123",
                    "page": "2",
                    "page_content": "Quarterly revenue increased by 18%.",
                    "workspace_id": "workspace-1",
                    "workspace_name": "workspace-1",
                    "reference": "[1]",
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
        workspace_names=["agent-brain-1", "agent-brain-2"],
        file_names=["doc-1", "doc-2"],
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


def test_connector_mcp_tools_strip_user_id_from_params(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["auth_headers"] = kwargs.get("auth_headers")
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
                "fixed_params": {"user_id": "fixed-user"},
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
        user_id="agent-user",
    )

    search_tool = next(
        tool
        for tool in tools
        if tool.name == "sharepoint_searchv2_search_document_blocks"
    )
    result = asyncio.run(
        search_tool.ainvoke({"params": {"query": "revenue", "user_id": "llm-user"}})
    )

    assert result == {"text": "ok"}
    assert captured["params"] == {"query": "revenue"}
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
        workspace_names=["agent-brain-1"],
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
