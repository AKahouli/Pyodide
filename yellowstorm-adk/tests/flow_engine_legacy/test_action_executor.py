import pytest

from src.flow_engine.legacy.action_executor import (
    execute_action_task,
    get_action_document_ids,
    get_action_document_metadata,
)


def test_action_executor_selects_only_bound_document_port_files_with_prefixed_ids() -> None:
    task = {
        "input_ports": [
            {"id": "in-docs", "artifact_kind": "document"},
            {"id": "notes", "artifact_kind": "text"},
        ]
    }
    resolved_inputs = {
        "ports": {
            "docs": {
                "resolved_documents": [
                    {
                        "document_id": "doc-1",
                        "filename": "a.pdf",
                        "filepath": "/tmp/a.pdf",
                        "workspace_id": "ws-1",
                    }
                ],
                "staged_files": [
                    {
                        "document_id": "doc-1",
                        "filename": "a.pdf",
                        "filepath": "/tmp/a.pdf",
                        "workspace_id": "ws-1",
                    }
                ],
                "document_bindings": {"document_ids": ["doc-1"]},
            },
            "notes": {
                "resolved_documents": [],
                "staged_files": [
                    {
                        "document_id": "doc-2",
                        "filename": "b.pdf",
                        "filepath": "/tmp/b.pdf",
                        "workspace_id": "ws-1",
                    }
                ],
                "document_bindings": {"document_ids": []},
            },
        },
        "playbook_workspace_context": [],
        "fallback_workspace_context": [],
        "workspace_context_mode": "resolved_inputs_only",
        "has_port_sources": True,
    }

    assert get_action_document_ids(task, resolved_inputs) == ["doc-1"]
    assert get_action_document_metadata(task, resolved_inputs) == [
        {
            "document_id": "doc-1",
            "filepath": "/tmp/a.pdf",
            "workspace_id": "ws-1",
            "filename": "a.pdf",
        }
    ]


@pytest.mark.asyncio
async def test_execute_action_task_uses_node_inputs_bound_to_document_ports_only(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.flow_engine.legacy.action_executor._get_vectorstores_url",
        lambda: "https://vectorstores.example.com",
    )
    captured_documents = []

    async def _fake_action_index_trigger(documents, vectorstores_url, task_id, workspace_settings):
        captured_documents.extend(documents)
        return {
            "results": [{"document_id": doc["document_id"]} for doc in documents],
            "errors": [],
        }

    async def _fake_await_indexing_completions(documents, futures, timeout=600):
        return {
            "completed": [{"document_id": doc["document_id"], "status": "ready"} for doc in documents],
            "failed": [],
        }

    monkeypatch.setattr(
        "src.flow_engine.legacy.action_executor._action_index_trigger",
        _fake_action_index_trigger,
    )
    monkeypatch.setattr(
        "src.flow_engine.legacy.action_executor._await_indexing_completions",
        _fake_await_indexing_completions,
    )

    task = {
        "id": "task-1",
        "selected_action": "index",
        "input_ports": [
            {"id": "in-docs", "artifact_kind": "document"},
            {"id": "notes", "artifact_kind": "text"},
        ],
        "output_ports": [{"id": "default", "artifact_kind": "document"}],
    }

    result = await execute_action_task(
        task,
        task_id="task-1",
        start_time=0.0,
        started_at="2026-04-20T00:00:00Z",
        workspace_context=[{"workspace_id": "ws-1"}],
        edges=[],
        upstream_results=[],
        artifacts_by_port={},
        node_inputs_by_port={
            "in-docs": [
                {
                    "artifact_kind": "document",
                    "document_id": "doc-1",
                    "filename": "a.pdf",
                    "filepath": "/tmp/a.pdf",
                    "workspace_id": "ws-1",
                    "source_task_id": "source-a",
                    "source_output_port_id": "out-docs",
                }
            ],
            "notes": [
                {
                    "artifact_kind": "document",
                    "document_id": "doc-2",
                    "filename": "b.pdf",
                    "filepath": "/tmp/b.pdf",
                    "workspace_id": "ws-1",
                    "source_task_id": "source-b",
                    "source_output_port_id": "out-notes",
                }
            ],
        },
    )

    assert result["status"] != "failed"
    assert [item["document_id"] for item in captured_documents] == ["doc-1"]
    result_payload = (result.get("results") or {}).get("task-1", {})
    artifact_docs = result_payload.get("artifacts") or []
    assert all(item.get("metadata", {}).get("document_id") != "doc-2" for item in artifact_docs)
