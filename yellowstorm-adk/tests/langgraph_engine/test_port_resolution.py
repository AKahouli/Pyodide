import pytest

from src.langgraph_engine.port_resolution import (
    build_tool_scope,
    resolve_task_inputs,
    validate_port_routing,
)


def test_validate_port_routing_rejects_duplicate_input_port() -> None:
    tasks = [
        {"id": "source_a", "title": "Source A"},
        {"id": "source_b", "title": "Source B"},
        {"id": "target", "title": "Target", "input_ports": [{"id": "doc_in", "name": "Doc In"}]},
    ]
    edges = [
        {"source_id": "source_a", "target_id": "target", "source_output_port_id": "default", "target_input_port_id": "doc_in"},
        {"source_id": "source_b", "target_id": "target", "source_output_port_id": "default", "target_input_port_id": "doc_in"},
    ]

    with pytest.raises(ValueError, match="multiple upstream sources"):
        validate_port_routing(tasks, edges)


def test_resolve_task_inputs_falls_back_to_workspace_context_when_unbound() -> None:
    resolved = resolve_task_inputs(
        "task-1",
        {"id": "task-1", "title": "Task 1", "description": "", "input_ports": []},
        {
            "edges": [],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {},
            "workspace_context": [{"documents": [{"filename": "alpha.csv"}, {"filename": "beta.csv"}]}],
        },
    )

    assert resolved["has_port_sources"] is False
    assert resolved["fallback_workspace_context"]
    assert build_tool_scope(resolved)["workspace_context_mode"] == "fallback_playbook"


def test_resolve_task_inputs_groups_documents_and_upstream_artifacts() -> None:
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [{"id": "summary", "name": "Summary", "artifact_kind": "text"}],
            "input_files_by_port": [{"port_id": "summary", "document_ids": ["doc-a", "doc-b"]}],
        },
        {
            "edges": [
                {
                    "source_id": "upstream",
                    "target_id": "downstream",
                    "source_output_port_id": "default",
                    "target_input_port_id": "summary",
                }
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {
                "upstream:default": [{"artifact_kind": "text", "content": "hello world"}],
            },
            "workspace_context": [],
        },
    )

    summary_port = resolved["ports"]["summary"]
    assert summary_port["upstream_binding"]["artifacts"][0]["content"] == "hello world"
    assert summary_port["document_bindings"]["document_ids"] == ["doc-a", "doc-b"]
    assert resolved["has_port_sources"] is True
    assert build_tool_scope(resolved)["all_document_ids"] == ["doc-a", "doc-b"]


def test_resolve_task_inputs_rejects_artifact_kind_mismatch() -> None:
    with pytest.raises(ValueError, match="expects artifact kind 'document' but received 'text'"):
        resolve_task_inputs(
            "downstream",
            {
                "id": "downstream",
                "title": "Downstream",
                "description": "",
                "input_ports": [{"id": "doc_in", "name": "Doc In", "artifact_kind": "document"}],
            },
            {
                "edges": [
                    {
                        "source_id": "upstream",
                        "target_id": "downstream",
                        "source_output_port_id": "default",
                        "target_input_port_id": "doc_in",
                    }
                ],
                "results": {},
                "task_outputs": {},
                "artifacts_by_port": {"upstream:default": [{"artifact_kind": "text", "content": "hello"}]},
                "workspace_context": [],
            },
        )


def test_resolve_task_inputs_accepts_backend_artifact_shape() -> None:
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [{"id": "doc_in", "name": "Doc In", "artifact_kind": "document"}],
        },
        {
            "edges": [
                {
                    "source_id": "upstream",
                    "target_id": "downstream",
                    "source_output_port_id": "default",
                    "target_input_port_id": "doc_in",
                }
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {
                "upstream:default": [
                    {
                        "artifactKind": "document",
                        "portId": "default",
                        "filename": "report.pdf",
                        "url": "https://example.com/report.pdf",
                    }
                ],
            },
            "workspace_context": [],
        },
    )

    doc_port = resolved["ports"]["doc_in"]
    assert doc_port["upstream_binding"]["artifact_kind"] == "document"
    assert doc_port["staged_files"][0]["filename"] == "report.pdf"
    assert doc_port["staged_files"][0]["filepath"] == "https://example.com/report.pdf"
