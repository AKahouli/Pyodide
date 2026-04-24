import pytest

from src.langgraph_engine.port_resolution import (
    build_task_prompt,
    build_task_prompt_context,
    build_tool_scope,
    resolve_task_inputs,
    task_has_trigger_port_inputs,
    validate_port_routing,
)


def test_validate_port_routing_accepts_duplicate_input_port() -> None:
    tasks = [
        {"id": "source_a", "title": "Source A"},
        {"id": "source_b", "title": "Source B"},
        {
            "id": "target",
            "title": "Target",
            "input_ports": [{"id": "doc_in", "name": "Doc In"}],
        },
    ]
    edges = [
        {
            "source_id": "source_a",
            "target_id": "target",
            "source_output_port_id": "default",
            "target_input_port_id": "doc_in",
        },
        {
            "source_id": "source_b",
            "target_id": "target",
            "source_output_port_id": "default",
            "target_input_port_id": "doc_in",
        },
    ]

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
            "workspace_context": [
                {"documents": [{"filename": "alpha.csv"}, {"filename": "beta.csv"}]}
            ],
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
            "input_ports": [
                {"id": "summary", "name": "Summary", "artifact_kind": "text"}
            ],
            "input_files_by_port": [
                {"port_id": "summary", "document_ids": ["doc-a", "doc-b"]}
            ],
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
                "upstream:default": [
                    {"artifact_kind": "text", "content": "hello world"}
                ],
            },
            "workspace_context": [],
        },
    )

    summary_port = resolved["ports"]["summary"]
    assert summary_port["upstream_binding"]["artifacts"][0]["content"] == "hello world"
    assert summary_port["document_bindings"]["document_ids"] == ["doc-a", "doc-b"]
    assert resolved["has_port_sources"] is True
    assert build_tool_scope(resolved)["all_document_ids"] == ["doc-a", "doc-b"]


def test_resolve_task_inputs_merges_multiple_upstream_sources_on_one_port() -> None:
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [
                {"id": "default", "name": "Input", "artifact_kind": "document"}
            ],
        },
        {
            "edges": [
                {
                    "source_id": "source_a",
                    "target_id": "downstream",
                    "source_output_port_id": "default",
                    "target_input_port_id": "default",
                },
                {
                    "source_id": "source_b",
                    "target_id": "downstream",
                    "source_output_port_id": "default",
                    "target_input_port_id": "default",
                },
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {
                "source_a:default": [
                    {
                        "artifact_kind": "document",
                        "filename": "a.pdf",
                        "url": "https://example.com/a.pdf",
                    }
                ],
                "source_b:default": [
                    {
                        "artifact_kind": "document",
                        "filename": "b.pdf",
                        "url": "https://example.com/b.pdf",
                    }
                ],
            },
            "workspace_context": [],
        },
    )

    default_port = resolved["ports"]["default"]
    assert len(default_port["upstream_bindings"]) == 2
    assert [item["filename"] for item in default_port["staged_files"]] == [
        "a.pdf",
        "b.pdf",
    ]


def test_resolve_task_inputs_filters_node_inputs_by_current_source_binding() -> None:
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [
                {"id": "default", "name": "Input", "artifact_kind": "document"}
            ],
        },
        {
            "edges": [
                {
                    "source_id": "source_a",
                    "target_id": "downstream",
                    "source_output_port_id": "default",
                    "target_input_port_id": "default",
                },
                {
                    "source_id": "source_b",
                    "target_id": "downstream",
                    "source_output_port_id": "default",
                    "target_input_port_id": "default",
                },
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {},
            "node_inputs_by_port": {
                "default": [
                    {
                        "artifact_kind": "document",
                        "filename": "a.pdf",
                        "url": "https://example.com/a.pdf",
                        "source_task_id": "source_a",
                        "source_output_port_id": "default",
                    },
                    {
                        "artifact_kind": "document",
                        "filename": "b.pdf",
                        "url": "https://example.com/b.pdf",
                        "source_task_id": "source_b",
                        "source_output_port_id": "default",
                    },
                ]
            },
            "workspace_context": [],
        },
    )

    default_port = resolved["ports"]["default"]
    assert len(default_port["upstream_bindings"]) == 2
    assert default_port["upstream_bindings"][0]["artifacts"] == [
        {
            "artifact_kind": "document",
            "filename": "a.pdf",
            "url": "https://example.com/a.pdf",
            "source_task_id": "source_a",
            "source_output_port_id": "default",
        }
    ]
    assert default_port["upstream_bindings"][1]["artifacts"] == [
        {
            "artifact_kind": "document",
            "filename": "b.pdf",
            "url": "https://example.com/b.pdf",
            "source_task_id": "source_b",
            "source_output_port_id": "default",
        }
    ]


def test_resolve_task_inputs_filters_prefixed_node_inputs_by_normalized_source_binding() -> None:
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [
                {"id": "in-shared", "name": "Input", "artifact_kind": "document"}
            ],
        },
        {
            "edges": [
                {
                    "source_id": "source_a",
                    "target_id": "downstream",
                    "source_output_port_id": "a1",
                    "target_input_port_id": "shared",
                },
                {
                    "source_id": "source_b",
                    "target_id": "downstream",
                    "source_output_port_id": "b1",
                    "target_input_port_id": "shared",
                },
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {},
            "node_inputs_by_port": {
                "shared": [
                    {
                        "artifact_kind": "document",
                        "filename": "a.pdf",
                        "url": "https://example.com/a.pdf",
                        "source_task_id": "source_a",
                        "source_output_port_id": "out-a1",
                    },
                    {
                        "artifact_kind": "document",
                        "filename": "b.pdf",
                        "url": "https://example.com/b.pdf",
                        "source_task_id": "source_b",
                        "source_output_port_id": "out-b1",
                    },
                ]
            },
            "workspace_context": [],
        },
    )

    shared_port = resolved["ports"]["shared"]
    assert shared_port["upstream_bindings"][0]["artifacts"][0]["filename"] == "a.pdf"
    assert shared_port["upstream_bindings"][1]["artifacts"][0]["filename"] == "b.pdf"


def test_resolve_task_inputs_rejects_artifact_kind_mismatch() -> None:
    with pytest.raises(
        ValueError, match="expects artifact kind 'document' but received 'text'"
    ):
        resolve_task_inputs(
            "downstream",
            {
                "id": "downstream",
                "title": "Downstream",
                "description": "",
                "input_ports": [
                    {"id": "doc_in", "name": "Doc In", "artifact_kind": "document"}
                ],
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
                    "upstream:default": [{"artifact_kind": "text", "content": "hello"}]
                },
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
            "input_ports": [
                {"id": "doc_in", "name": "Doc In", "artifact_kind": "document"}
            ],
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


def test_validate_port_routing_accepts_prefixed_and_unprefixed_port_ids() -> None:
    tasks = [
        {
            "id": "source",
            "title": "Source",
            "output_ports": [{"id": "out-d5ebb147", "name": "Out"}],
        },
        {
            "id": "target",
            "title": "Target",
            "input_ports": [{"id": "in-0d697e28", "name": "In"}],
        },
    ]
    edges = [
        {
            "source_id": "source",
            "target_id": "target",
            "source_output_port_id": "d5ebb147",
            "target_input_port_id": "0d697e28",
        }
    ]

    validate_port_routing(tasks, edges)


def test_validate_port_routing_accepts_reserved_trigger_source_ports() -> None:
    tasks = [
        {
            "id": "target",
            "title": "Target",
            "input_ports": [{"id": "mail_in", "name": "Mail", "artifact_kind": "data"}],
        },
    ]
    edges = [
        {
            "source_id": "__trigger__",
            "target_id": "target",
            "source_output_port_id": "mail_data",
            "target_input_port_id": "mail_in",
        }
    ]

    validate_port_routing(tasks, edges)


def test_resolve_task_inputs_uses_explicit_trigger_attachment_documents() -> None:
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [
                {"id": "default", "name": "Input", "artifact_kind": "document"}
            ],
        },
        {
            "edges": [
                {
                    "source_id": "__trigger__",
                    "target_id": "downstream",
                    "source_output_port_id": "mail_attachments",
                    "target_input_port_id": "default",
                }
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {},
            "workspace_context": [],
            "trigger_context": {
                "type": "mail",
                "ports": {
                    "mail_attachments": {
                        "kind": "document",
                        "documentIds": ["doc-1"],
                        "documents": [
                            {
                                "documentId": "doc-1",
                                "filename": "slides.pptx",
                                "filepath": "workspace/documents/slides.pptx",
                                "workspaceId": "ws-1",
                                "mimeType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                            }
                        ],
                    }
                },
            },
        },
    )

    default_port = resolved["ports"]["default"]
    assert default_port["upstream_binding"]["artifact_kind"] == "document"
    assert default_port["resolved_documents"] == []
    assert default_port["workspace_artifacts"][0]["document_id"] == "doc-1"
    assert default_port["staged_files"][0]["filepath"] == "workspace/documents/slides.pptx"


def test_resolve_task_inputs_reads_mail_data_from_current_trigger_context_only() -> (
    None
):
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [{"id": "mail_in", "name": "Mail", "artifact_kind": "data"}],
        },
        {
            "edges": [
                {
                    "source_id": "__trigger__",
                    "target_id": "downstream",
                    "source_output_port_id": "mail_data",
                    "target_input_port_id": "mail_in",
                }
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {
                "other_task:mail_data": [{"artifact_kind": "data", "content": "WRONG"}],
            },
            "workspace_context": [],
            "trigger_context": {
                "type": "mail",
                "ports": {
                    "mail_data": {
                        "kind": "data",
                        "value": {
                            "subject": "Expected subject",
                            "bodyText": "Expected body",
                            "receivedAt": "2026-04-18T10:00:00Z",
                            "from": {"name": "Ops", "address": "ops@example.com"},
                            "to": [],
                            "cc": [],
                            "bodyHtml": None,
                            "hasAttachments": False,
                            "providerMessageId": "msg-1",
                            "providerThreadId": "thread-1",
                        },
                    }
                },
            },
        },
    )

    mail_port = resolved["ports"]["mail_in"]
    assert mail_port["upstream_binding"]["source_task_id"] == "__trigger__"
    assert (
        "Expected subject" in mail_port["upstream_binding"]["artifacts"][0]["content"]
    )
    assert "WRONG" not in mail_port["upstream_binding"]["artifacts"][0]["content"]


def test_resolve_task_inputs_reads_mail_attachment_document_ids_from_current_trigger_context() -> (
    None
):
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [
                {
                    "id": "attachments",
                    "name": "Attachments",
                    "artifact_kind": "document",
                }
            ],
        },
        {
            "edges": [
                {
                    "source_id": "__trigger__",
                    "target_id": "downstream",
                    "source_output_port_id": "mail_attachments",
                    "target_input_port_id": "attachments",
                }
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {},
            "workspace_context": [
                {
                    "documents": [
                        {
                            "id": "doc-1",
                            "filename": "a.pdf",
                            "filepath": "/tmp/a.pdf",
                            "workspace_id": "ws-1",
                        },
                        {
                            "id": "doc-2",
                            "filename": "b.pdf",
                            "filepath": "/tmp/b.pdf",
                            "workspace_id": "ws-1",
                        },
                    ]
                }
            ],
            "trigger_context": {
                "type": "mail",
                "ports": {
                    "mail_attachments": {
                        "kind": "document",
                        "documentIds": ["doc-1", "doc-2"],
                    }
                },
            },
        },
    )

    attachment_port = resolved["ports"]["attachments"]
    assert attachment_port["upstream_binding"]["source_task_id"] == "__trigger__"
    assert [doc["filename"] for doc in attachment_port["resolved_documents"]] == [
        "a.pdf",
        "b.pdf",
    ]
    tool_scope = build_tool_scope(resolved)
    assert tool_scope["all_document_ids"] == ["doc-1", "doc-2"]
    assert tool_scope["documents_by_port"]["attachments"] == ["doc-1", "doc-2"]


def test_build_tool_scope_includes_upstream_document_artifact_ids() -> None:
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [
                {"id": "docs", "name": "Docs", "artifact_kind": "document"}
            ],
        },
        {
            "edges": [
                {
                    "source_id": "upstream",
                    "target_id": "downstream",
                    "source_output_port_id": "default",
                    "target_input_port_id": "docs",
                }
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {
                "upstream:default": [
                    {
                        "artifact_kind": "document",
                        "document_id": "doc-7",
                        "filename": "brief.pdf",
                        "filepath": "/tmp/brief.pdf",
                        "workspace_id": "ws-1",
                    }
                ]
            },
            "workspace_context": [],
        },
    )

    tool_scope = build_tool_scope(resolved)

    assert tool_scope["all_document_ids"] == ["doc-7"]
    assert tool_scope["documents_by_port"]["docs"] == ["doc-7"]
    assert tool_scope["files_by_port"]["docs"][0]["document_id"] == "doc-7"


def test_build_task_prompt_context_returns_structured_prompt_ready_inputs() -> None:
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "Summarize inputs",
            "input_ports": [{"id": "mail_in", "name": "Mail", "artifact_kind": "data"}],
            "output_ports": [
                {"id": "default", "name": "Output", "artifact_kind": "text"}
            ],
        },
        {
            "edges": [
                {
                    "source_id": "__trigger__",
                    "target_id": "downstream",
                    "source_output_port_id": "mail_data",
                    "target_input_port_id": "mail_in",
                }
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {},
            "workspace_context": [],
            "trigger_context": {
                "type": "mail",
                "ports": {
                    "mail_data": {
                        "kind": "data",
                        "value": {
                            "subject": "FW: Yellowsys.ai",
                            "bodyText": "Mail body",
                        },
                    }
                },
            },
        },
    )

    prompt_context = build_task_prompt_context(
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "Summarize inputs",
            "output_ports": [
                {"id": "default", "name": "Output", "artifact_kind": "text"}
            ],
        },
        resolved,
        user_query="FW: Yellowsys.ai",
        trigger_context={"type": "mail"},
    )

    assert prompt_context["task"]["id"] == "downstream"
    assert prompt_context["metadata"]["default_workspace_id"] == ""
    assert prompt_context["has_port_sources"] is True
    assert prompt_context["has_trigger_port_inputs"] is True
    assert prompt_context["resolved_inputs"][0]["input_port_id"] == "mail_in"
    assert (
        prompt_context["resolved_inputs"][0]["sources"][0]["source_task_id"]
        == "__trigger__"
    )
    assert prompt_context["resolved_inputs"][0]["sources"][0]["artifacts"][0][
        "data"
    ] == {
        "subject": "FW: Yellowsys.ai",
        "bodyText": "Mail body",
    }


def test_build_task_prompt_context_includes_default_workspace_metadata() -> None:
    prompt_context = build_task_prompt_context(
        {
            "id": "task-1",
            "title": "Task",
            "description": "",
            "output_ports": [],
        },
        {
            "task_id": "task-1",
            "ports": {},
            "playbook_workspace_context": [
                {
                    "workspace_id": "ws-default",
                    "documents": [],
                }
            ],
            "fallback_workspace_context": [],
            "workspace_context_mode": "resolved_inputs_only",
            "has_port_sources": False,
        },
    )

    assert prompt_context["metadata"]["default_workspace_id"] == "ws-default"


def test_build_task_prompt_uses_structured_json_and_skips_duplicate_trigger_section() -> (
    None
):
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Task",
            "description": "Describe the email",
            "input_ports": [{"id": "mail_in", "name": "Mail", "artifact_kind": "data"}],
            "output_ports": [
                {"id": "default", "name": "Output", "artifact_kind": "text"}
            ],
        },
        {
            "edges": [
                {
                    "source_id": "__trigger__",
                    "target_id": "downstream",
                    "source_output_port_id": "mail_data",
                    "target_input_port_id": "mail_in",
                }
            ],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {},
            "workspace_context": [],
            "trigger_context": {
                "type": "mail",
                "ports": {
                    "mail_data": {
                        "kind": "data",
                        "value": {"subject": "FW: Yellowsys.ai"},
                    }
                },
                "payload": {
                    "message": {
                        "subject": "FW: Yellowsys.ai",
                        "from": {"name": "Sender", "address": "sender@example.com"},
                        "to": [],
                    }
                },
            },
        },
    )

    prompt = build_task_prompt(
        {
            "id": "downstream",
            "title": "Task",
            "description": "Describe the email",
            "output_ports": [
                {"id": "default", "name": "Output", "artifact_kind": "text"}
            ],
        },
        resolved,
        trigger_context={
            "type": "mail",
            "payload": {
                "message": {
                    "subject": "FW: Yellowsys.ai",
                    "from": {"name": "Sender", "address": "sender@example.com"},
                    "to": [],
                }
            },
        },
        user_query="FW: Yellowsys.ai",
    )

    assert "Structured inputs for this task JSON:" in prompt
    assert '"input_port_id": "mail_in"' in prompt
    assert '"subject": "FW: Yellowsys.ai"' in prompt
    assert "This playbook was triggered by an incoming email:" not in prompt


def test_task_has_trigger_port_inputs_detects_bound_trigger_sources() -> None:
    resolved = {
        "ports": {
            "mail_in": {
                "upstream_bindings": [
                    {
                        "source_task_id": "__trigger__",
                        "source_output_port_id": "mail_data",
                    }
                ]
            }
        }
    }

    assert task_has_trigger_port_inputs(resolved) is True


def test_resolve_task_inputs_inferrs_single_mail_data_binding_when_trigger_edge_missing() -> (
    None
):
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [
                {"id": "default", "name": "Input", "artifact_kind": "data"}
            ],
        },
        {
            "edges": [],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {},
            "workspace_context": [],
            "trigger_context": {
                "type": "mail",
                "ports": {
                    "mail_data": {
                        "kind": "data",
                        "value": {
                            "subject": "FW: Yellowsys.ai",
                            "bodyText": "Expected body",
                        },
                    }
                },
            },
        },
    )

    assert resolved["has_port_sources"] is True
    assert (
        resolved["ports"]["default"]["upstream_binding"]["source_task_id"]
        == "__trigger__"
    )
    assert (
        resolved["ports"]["default"]["upstream_binding"]["source_output_port_id"]
        == "mail_data"
    )
    assert resolved["ports"]["default"]["upstream_binding"]["artifacts"][0]["data"] == {
        "subject": "FW: Yellowsys.ai",
        "bodyText": "Expected body",
    }


def test_resolve_task_inputs_does_not_infer_mail_binding_when_ambiguous() -> None:
    resolved = resolve_task_inputs(
        "downstream",
        {
            "id": "downstream",
            "title": "Downstream",
            "description": "",
            "input_ports": [
                {"id": "mail_a", "name": "Mail A", "artifact_kind": "data"},
                {"id": "mail_b", "name": "Mail B", "artifact_kind": "data"},
            ],
        },
        {
            "edges": [],
            "results": {},
            "task_outputs": {},
            "artifacts_by_port": {},
            "workspace_context": [],
            "trigger_context": {
                "type": "mail",
                "ports": {
                    "mail_data": {
                        "kind": "data",
                        "value": {"subject": "FW: Yellowsys.ai"},
                    }
                },
            },
        },
    )

    assert resolved["has_port_sources"] is False
    assert resolved["ports"]["mail_a"]["upstream_bindings"] == []
    assert resolved["ports"]["mail_b"]["upstream_bindings"] == []
