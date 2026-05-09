import asyncio
import sys
from types import SimpleNamespace

import pytest
import src.langgraph_engine.graph_builder as graph_builder_module
from src.langgraph_engine.graph_builder import (
    DynamicGraphBuilder,
    _extract_artifacts_from_components,
    _build_default_text_artifact,
    _build_execution_clarification_guidance,
    _get_clarification_context,
    _store_clarification_context,
    _resolve_output_port,
    _collect_prior_source_components,
    _resolve_iterator_collection_from_inputs,
)


def _install_fake_tool_factory(monkeypatch, create_langchain_tools) -> None:
    monkeypatch.setitem(
        sys.modules,
        "src.langgraph_engine.playbook_tool_factory",
        SimpleNamespace(create_langchain_tools=create_langchain_tools),
    )


def test_collect_prior_source_components_returns_sources_and_citations_in_task_order() -> None:
    state = {
        "tasks": [
            {"id": "step-2", "execution_order": 2},
            {"id": "step-1", "execution_order": 1},
            {"id": "step-3", "execution_order": 3},
        ],
        "results": {
            "step-1": {
                "components": [
                    {
                        "type": "citation",
                        "data": {
                            "text_source": {
                                "source": "Doc 1",
                                "reference": "1",
                            }
                        },
                    }
                ]
            },
            "step-2": {
                "components": [
                    {
                        "type": "sources",
                        "data": {
                            "sources": [
                                {
                                    "title": "Doc 2",
                                    "url": "https://example.com/doc-2",
                                }
                            ]
                        },
                    },
                    {
                        "type": "citation",
                        "data": {
                            "text_source": {
                                "source": "Doc 2",
                                "reference": "6",
                            }
                        },
                    },
                ]
            },
        },
    }

    components = _collect_prior_source_components(state, "step-3")

    assert [component["type"] for component in components] == [
        "citation",
        "sources",
        "citation",
    ]
    assert components[0]["data"]["text_source"]["reference"] == "1"
    assert components[2]["data"]["text_source"]["reference"] == "6"


def test_extract_artifacts_routes_explicit_same_kind_outputs_by_port_id() -> None:
    artifacts = _extract_artifacts_from_components(
        [
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "output_port_id": "out-pdf",
                    "file_path": "https://example.com/report.pdf",
                    "filename": "report.pdf",
                },
            },
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "output_port_id": "out-pptx",
                    "file_path": "https://example.com/deck.pptx",
                    "filename": "deck.pptx",
                },
            },
        ],
        {
            "output_ports": [
                {"id": "out-pdf", "name": "PDF", "artifact_kind": "document"},
                {"id": "out-pptx", "name": "pptx", "artifact_kind": "document"},
            ]
        },
    )

    assert artifacts == [
        {
            "port_id": "out-pdf",
            "artifact_kind": "document",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
            "mime_type": "",
        },
        {
            "port_id": "out-pptx",
            "artifact_kind": "document",
            "url": "https://example.com/deck.pptx",
            "filename": "deck.pptx",
            "mime_type": "",
        },
    ]


def test_extract_artifacts_routes_same_kind_outputs_by_filename() -> None:
    artifacts = _extract_artifacts_from_components(
        [
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "file_path": "https://example.com/report.pdf",
                    "filename": "report.pdf",
                },
            },
        ],
        {
            "id": "task-1",
            "output_ports": [
                {"id": "out-pdf", "name": "PDF", "artifact_kind": "document"},
                {"id": "out-docx", "name": "DOCX", "artifact_kind": "document"},
            ],
        },
    )

    assert artifacts == [
        {
            "port_id": "out-pdf",
            "artifact_kind": "document",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
            "mime_type": "",
        }
    ]


def test_extract_artifacts_infers_file_kind_before_routing() -> None:
    artifacts = _extract_artifacts_from_components(
        [
            {
                "type": "artifact",
                "data": {
                    "file_path": "https://example.com/report.pdf",
                    "filename": "report.pdf",
                },
            },
            {
                "type": "artifact",
                "data": {
                    "file_path": "https://example.com/deck.pptx",
                    "filename": "deck.pptx",
                },
            },
        ],
        {
            "id": "task-1",
            "output_ports": [
                {"id": "pdf-doc", "name": "PDF doc", "artifact_kind": "document"},
                {"id": "ppt-doc", "name": "PPT doc", "artifact_kind": "document"},
            ],
        },
    )

    assert [artifact["port_id"] for artifact in artifacts] == ["pdf-doc", "ppt-doc"]
    assert [artifact["artifact_kind"] for artifact in artifacts] == [
        "document",
        "document",
    ]


def test_build_default_text_artifact_uses_default_port_for_plain_text() -> None:
    artifact = _build_default_text_artifact(
        {
            "output_ports": [
                {"id": "default", "artifact_kind": "text"},
            ]
        },
        "  Hello downstream  ",
    )

    assert artifact == {
        "port_id": "default",
        "artifact_kind": "text",
        "content": "Hello downstream",
    }


def test_build_default_text_artifact_falls_back_to_description() -> None:
    artifact = _build_default_text_artifact(
        {
            "output_ports": [
                {"id": "default", "artifact_kind": "text"},
            ]
        },
        "",
        "Clarified task description",
    )

    assert artifact == {
        "port_id": "default",
        "artifact_kind": "text",
        "content": "Clarified task description",
    }


def test_resolve_output_port_falls_back_to_default_port_when_ambiguous() -> None:
    port = _resolve_output_port(
        {"id": "task-1"},
        [
            {"id": "default", "artifact_kind": "document"},
            {"id": "secondary", "artifact_kind": "document"},
        ],
        preferred_kind="document",
        component_label="artifact 'report.pdf'",
    )

    assert port is not None
    assert port["id"] == "default"


def test_resolve_output_port_falls_back_to_first_port_when_no_default() -> None:
    port = _resolve_output_port(
        {"id": "task-1"},
        [
            {"id": "out-doc", "artifact_kind": "document"},
            {"id": "out-data", "artifact_kind": "document"},
        ],
        preferred_kind="document",
        component_label="artifact 'report.pdf'",
    )

    assert port is not None


def test_resolve_iterator_collection_from_inputs_uses_data_array() -> None:
    items = _resolve_iterator_collection_from_inputs(
        {
            "ports": {
                "items": {
                    "input_port": {"id": "items", "artifact_kind": "data"},
                    "upstream_bindings": [
                        {
                            "artifacts": [
                                {
                                    "artifact_kind": "data",
                                    "data": [
                                        {"id": 1, "name": "Project Alpha"},
                                        {"id": 2, "name": "Project Beta"},
                                    ],
                                }
                            ]
                        }
                    ],
                }
            }
        }
    )

    assert items == [
        {"id": 1, "name": "Project Alpha"},
        {"id": 2, "name": "Project Beta"},
    ]


def test_resolve_iterator_collection_from_inputs_unwraps_port_keyed_data_array() -> None:
    items = _resolve_iterator_collection_from_inputs(
        {
            "ports": {
                "items": {
                    "input_port": {"id": "items", "artifact_kind": "data"},
                    "upstream_bindings": [
                        {
                            "artifacts": [
                                {
                                    "artifact_kind": "data",
                                    "data": {
                                        "items": [
                                            {"id": 1, "name": "Project Alpha"},
                                            {"id": 2, "name": "Project Beta"},
                                        ]
                                    },
                                }
                            ]
                        }
                    ],
                }
            }
        }
    )

    assert items == [
        {"id": 1, "name": "Project Alpha"},
        {"id": 2, "name": "Project Beta"},
    ]


def test_resolve_iterator_collection_from_inputs_uses_json_content_array() -> None:
    items = _resolve_iterator_collection_from_inputs(
        {
            "ports": {
                "items": {
                    "input_port": {"id": "items", "artifact_kind": "data"},
                    "upstream_bindings": [
                        {
                            "artifacts": [
                                {
                                    "artifact_kind": "data",
                                    "content": '[{"id": 1}, {"id": 2}]',
                                }
                            ]
                        }
                    ],
                }
            }
        }
    )

    assert items == [{"id": 1}, {"id": 2}]


def test_resolve_iterator_collection_from_inputs_unwraps_port_keyed_json_content_array() -> None:
    items = _resolve_iterator_collection_from_inputs(
        {
            "ports": {
                "items": {
                    "input_port": {"id": "items", "artifact_kind": "data"},
                    "upstream_bindings": [
                        {
                            "artifacts": [
                                {
                                    "artifact_kind": "data",
                                    "content": '{"items": [{"id": 1}, {"id": 2}]}',
                                }
                            ]
                        }
                    ],
                }
            }
        }
    )

    assert items == [{"id": 1}, {"id": 2}]


def test_resolve_iterator_collection_from_inputs_wraps_plain_content() -> None:
    items = _resolve_iterator_collection_from_inputs(
        {
            "ports": {
                "items": {
                    "input_port": {"id": "items", "artifact_kind": "data"},
                    "upstream_bindings": [
                        {
                            "artifacts": [
                                {
                                    "artifact_kind": "data",
                                    "content": "not-json",
                                }
                            ]
                        }
                    ],
                }
            }
        }
    )

    assert items == ["not-json"]


def test_resolve_iterator_collection_from_inputs_uses_document_bindings() -> None:
    items = _resolve_iterator_collection_from_inputs(
        {
            "ports": {
                "documents": {
                    "input_port": {"id": "documents", "artifact_kind": "document"},
                    "resolved_documents": [
                        {"document_id": "doc-1", "filename": "A.docx"},
                        {"document_id": "doc-2", "filename": "B.docx"},
                    ],
                    "document_bindings": {"document_ids": ["doc-1", "doc-2"]},
                }
            }
        }
    )

    assert items == [
        {"document_id": "doc-1", "filename": "A.docx"},
        {"document_id": "doc-2", "filename": "B.docx"},
    ]


def test_resolve_iterator_collection_from_inputs_wraps_single_data_object() -> None:
    items = _resolve_iterator_collection_from_inputs(
        {
            "ports": {
                "items": {
                    "input_port": {"id": "items", "artifact_kind": "data"},
                    "upstream_bindings": [
                        {
                            "artifacts": [
                                {
                                    "artifact_kind": "data",
                                    "data": {"id": 1, "name": "Project Alpha"},
                                }
                            ]
                        }
                    ],
                }
            }
        }
    )

    assert items == [{"id": 1, "name": "Project Alpha"}]


def test_extract_artifacts_from_components_falls_back_on_ambiguous_port() -> None:
    artifacts = _extract_artifacts_from_components(
        [
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "file_path": "/tmp/report.pdf",
                    "filename": "report.pdf",
                },
            },
        ],
        {
            "id": "task-1",
            "output_ports": [
                {"id": "default", "artifact_kind": "document"},
                {"id": "secondary", "artifact_kind": "document"},
            ],
        },
    )

    assert len(artifacts) == 1
    assert artifacts[0]["port_id"] == "default"
    assert artifacts[0]["filename"] == "report.pdf"


def test_fuzzy_matching_routes_attestation_to_description_port() -> None:
    artifacts = _extract_artifacts_from_components(
        [
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "file_path": "/tmp/attestation_synthese.pdf",
                    "filename": "attestation_synthese.pdf",
                },
            },
        ],
        {
            "id": "task-1",
            "output_ports": [
                {
                    "id": "out-attestation",
                    "artifact_kind": "document",
                    "name": "Attestation",
                    "description": "Synthèse des résultats de l'audit",
                },
                {
                    "id": "out-data",
                    "artifact_kind": "document",
                    "name": "Données brutes",
                    "description": "Données de collecte brutes",
                },
            ],
        },
    )

    assert len(artifacts) == 1
    assert artifacts[0]["port_id"] == "out-attestation"


def test_fuzzy_matching_routes_synthese_to_description_port() -> None:
    artifacts = _extract_artifacts_from_components(
        [
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "file_path": "/tmp/rapport_synthese.pdf",
                    "filename": "rapport_synthese.pdf",
                },
            },
        ],
        {
            "id": "task-1",
            "output_ports": [
                {
                    "id": "out-attestation",
                    "artifact_kind": "document",
                    "name": "Attestation",
                    "description": "Attestation de conformité",
                },
                {
                    "id": "out-synthese",
                    "artifact_kind": "document",
                    "name": "Synthèse",
                    "description": "Synthèse des résultats",
                },
            ],
        },
    )

    assert len(artifacts) == 1
    assert artifacts[0]["port_id"] == "out-synthese"


def test_fuzzy_matching_falls_back_when_no_description_match() -> None:
    artifacts = _extract_artifacts_from_components(
        [
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "file_path": "/tmp/random_file.pdf",
                    "filename": "random_file.pdf",
                },
            },
        ],
        {
            "id": "task-1",
            "output_ports": [
                {
                    "id": "default",
                    "artifact_kind": "document",
                    "name": "Default",
                    "description": "Default output port",
                },
                {
                    "id": "secondary",
                    "artifact_kind": "document",
                    "name": "Secondary",
                    "description": "Secondary output port",
                },
            ],
        },
    )

    assert len(artifacts) == 1
    assert artifacts[0]["port_id"] == "default"


def test_clarification_context_round_trips_through_state() -> None:
    state = {
        "clarification_transcripts_by_task": {},
        "task_description_overrides_by_task": {},
        "artifacts_by_port": {},
        "task_outputs": {},
    }

    transcript = [
        {"role": "assistant", "content": "Need scope details?"},
        {"role": "user", "content": "Cybersécurité des PME — France — 90 jours"},
    ]
    description = "Base task description\n\nClarification from user: Cybersécurité des PME — France — 90 jours"

    _store_clarification_context(state, "task-1", transcript, description)

    restored_transcript, restored_description = _get_clarification_context(
        state, "task-1"
    )

    assert restored_transcript == transcript
    assert restored_description == description
    assert state["artifacts_by_port"] == {
        "task-1:default": [
            {
                "port_id": "default",
                "artifact_kind": "text",
                "content": description,
            }
        ],
    }
    assert state["task_outputs"] == {"task-1_output": description}


def test_task_without_assigned_agent_emits_failed_step_update() -> None:
    updates = []

    async def on_step_update(update):
        updates.append(update)

    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    node = builder._create_task_node(
        "task-1",
        {"id": "task-1", "title": "Task 1", "assigned_agent_id": "missing-agent"},
        on_step_update,
    )

    result = asyncio.run(
        node({"agents": {}, "playbook_id": "pb-1", "thread_id": "th-1"}, {})
    )

    assert result["status"] == "failed"
    assert updates
    assert updates[0]["status"] == "failed"
    assert updates[0]["result"]["error"] == "No agent assigned to task task-1"


def test_evaluation_task_without_assigned_agent_fails_like_other_tasks() -> None:
    updates = []

    async def on_step_update(update):
        updates.append(update)

    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    node = builder._create_task_node(
        "task-1",
        {
            "id": "task-1",
            "title": "Evaluation Task",
            "task_type": "evaluation",
            "evaluation_config": {},
        },
        on_step_update,
    )

    result = asyncio.run(
        node(
            {
                "agents": {},
                "playbook_id": "pb-1",
                "thread_id": "th-1",
            },
            {},
        )
    )

    assert result["status"] == "failed"
    assert updates
    assert updates[0]["status"] == "failed"
    assert updates[0]["result"]["error"] == "No agent assigned to task task-1"


def test_workflow_task_node_uses_structured_output_artifacts_for_downstream_state(
    monkeypatch,
) -> None:
    async def fake_direct_call(*args, **kwargs):
        return "Live preview output", {
            "input_tokens": 1,
            "output_tokens": 1,
            "total_tokens": 2,
            "model": "test",
        }

    async def fake_synthesize(*args, **kwargs):
        return [
            {
                "output_port_id": "summary",
                "artifact_kind": "text",
                "content": "Final summary",
            }
        ]

    def fake_create_langchain_tools(*args, **kwargs):
        return [], None

    monkeypatch.setattr(
        graph_builder_module,
        "_task_requires_structured_output_synthesis",
        lambda task: True,
    )
    monkeypatch.setattr(
        graph_builder_module, "_synthesize_structured_outputs", fake_synthesize
    )
    monkeypatch.setattr(
        graph_builder_module,
        "_build_task_artifacts_from_structured_outputs",
        lambda task, structured_outputs, generated_artifacts: [
            {
                "port_id": "summary",
                "artifact_kind": "text",
                "content": "Final summary",
            }
        ],
    )
    monkeypatch.setattr(
        graph_builder_module, "_collect_generated_artifacts", lambda components: []
    )
    monkeypatch.setattr(
        DynamicGraphBuilder, "_llm_direct_call", staticmethod(fake_direct_call)
    )
    _install_fake_tool_factory(monkeypatch, fake_create_langchain_tools)
    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(LITELLM_API_BASE_URL="", LITELLM_API_SECRET_KEY=""),
    )

    updates = []

    async def on_step_update(update):
        updates.append(update)

    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    node = builder._create_task_node(
        "task-1",
        {
            "id": "task-1",
            "title": "Task 1",
            "description": "desc",
            "assigned_agent_id": "agent-1",
            "output_ports": [
                {"id": "summary", "name": "Summary", "artifact_kind": "text"},
                {"id": "context", "name": "Context", "artifact_kind": "text"},
            ],
        },
        on_step_update,
    )

    result = asyncio.run(
        node(
            {
                "agents": {
                    "agent-1": {
                        "id": "agent-1",
                        "name": "Agent",
                        "instructions": "Do it",
                        "tools": [],
                    }
                },
                "playbook_id": "pb-1",
                "thread_id": "th-1",
                "tasks": [{"id": "task-1", "title": "Task 1"}],
                "edges": [],
                "results": {},
                "task_outputs": {},
                "workspace_context": [],
                "execution_mode": "live",
                "validated_replays_by_task": {},
                "step_execution_modes": {},
                "query": "",
                "current_task_ids": [],
                "completed_task_ids": [],
                "status": "in_progress",
                "error": None,
                "interrupt_payload": None,
                "node_timings": {},
                "evaluation_user_id": "unknown",
                "artifacts_by_port": {},
            },
            {},
        )
    )

    assert result["artifacts_by_port"] == {
        "task-1:summary": [
            {
                "port_id": "summary",
                "artifact_kind": "text",
                "content": "Final summary",
            }
        ],
    }


def test_build_structured_context_skips_legacy_dependency_text_when_ports_are_bound() -> (
    None
):
    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)

    context, resolved_inputs, workspace_artifacts = builder._build_structured_context(
        "task-b",
        {
            "id": "task-b",
            "title": "Task B",
            "description": "Use bound inputs",
            "input_ports": [
                {"id": "summary", "name": "Summary", "artifact_kind": "text"}
            ],
            "input_keys": ["task_a_output"],
        },
        {
            "edges": [
                {
                    "source_id": "task-a",
                    "target_id": "task-b",
                    "source_output_port_id": "default",
                    "target_input_port_id": "summary",
                }
            ],
            "results": {
                "task-a": {
                    "output": "Legacy dependency output",
                }
            },
            "task_outputs": {"task_a_output": "Legacy input key output"},
            "artifacts_by_port": {
                "task-a:default": [
                    {"artifact_kind": "text", "content": "Bound port artifact"}
                ]
            },
            "workspace_context": [],
            "tasks": [{"id": "task-a", "title": "Task A"}],
        },
    )

    assert context == ""
    assert resolved_inputs["has_port_sources"] is True
    assert workspace_artifacts == []


def test_workflow_task_node_builds_default_text_artifact_without_explicit_output(
    monkeypatch,
) -> None:
    async def fake_direct_call(*args, **kwargs):
        return "", {
            "input_tokens": 1,
            "output_tokens": 1,
            "total_tokens": 2,
            "model": "test",
        }

    def fake_create_langchain_tools(*args, **kwargs):
        return [], None

    monkeypatch.setattr(
        DynamicGraphBuilder, "_llm_direct_call", staticmethod(fake_direct_call)
    )
    _install_fake_tool_factory(monkeypatch, fake_create_langchain_tools)
    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(LITELLM_API_BASE_URL="", LITELLM_API_SECRET_KEY=""),
    )

    updates = []

    async def on_step_update(update):
        updates.append(update)

    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    node = builder._create_task_node(
        "task-1",
        {
            "id": "task-1",
            "title": "Task 1",
            "description": "desc",
            "assigned_agent_id": "agent-1",
            "output_key": "task_1_output",
            "output_ports": [
                {"id": "default", "name": "Default", "artifact_kind": "text"},
            ],
        },
        on_step_update,
    )

    result = asyncio.run(
        node(
            {
                "agents": {
                    "agent-1": {
                        "id": "agent-1",
                        "name": "Agent",
                        "instructions": "Do it",
                        "tools": [],
                    }
                },
                "playbook_id": "pb-1",
                "thread_id": "th-1",
                "tasks": [{"id": "task-1", "title": "Task 1"}],
                "edges": [],
                "results": {},
                "task_outputs": {},
                "workspace_context": [],
                "execution_mode": "live",
                "validated_replays_by_task": {},
                "step_execution_modes": {},
                "query": "",
                "current_task_ids": [],
                "completed_task_ids": [],
                "status": "in_progress",
                "error": None,
                "interrupt_payload": None,
                "node_timings": {},
                "evaluation_user_id": "unknown",
                "artifacts_by_port": {},
            },
            {},
        )
    )

    assert result["artifacts_by_port"] == {
        "task-1:default": [
            {
                "port_id": "default",
                "artifact_kind": "text",
                "content": "desc",
            }
        ],
    }
    assert updates[-1]["result"]["artifacts"][0]["port_id"] == "default"


def test_workflow_task_node_resolves_clarification_prompt_before_main_prompt_build(
    monkeypatch,
) -> None:
    direct_call_system_prompts = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        async def ainvoke(self, messages):
            return SimpleNamespace(content="CLEAR")

    async def fake_direct_call(*args, **kwargs):
        direct_call_system_prompts.append(args[2])
        raise RuntimeError("sentinel-direct-call")

    def fake_create_langchain_tools(*args, **kwargs):
        return [], None

    monkeypatch.setitem(
        sys.modules,
        "langchain_openai",
        SimpleNamespace(ChatOpenAI=FakeChatOpenAI),
    )
    monkeypatch.setattr(
        DynamicGraphBuilder, "_llm_direct_call", staticmethod(fake_direct_call)
    )
    _install_fake_tool_factory(monkeypatch, fake_create_langchain_tools)
    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(LITELLM_API_BASE_URL="", LITELLM_API_SECRET_KEY=""),
    )

    updates = []

    async def on_step_update(update):
        updates.append(update)

    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    node = builder._create_task_node(
        "task-1",
        {
            "id": "task-1",
            "title": "Task 1",
            "description": "desc",
            "assigned_agent_id": "agent-1",
            "allow_clarification": True,
            "max_clarifications": 1,
            "output_key": "task_1_output",
            "output_ports": [
                {"id": "default", "name": "Default", "artifact_kind": "text"},
            ],
        },
        on_step_update,
    )

    result = asyncio.run(
        node(
            {
                "agents": {
                    "agent-1": {
                        "id": "agent-1",
                        "name": "Agent",
                        "instructions": "Do it",
                        "tools": [],
                    }
                },
                "playbook_id": "pb-1",
                "thread_id": "th-1",
                "tasks": [{"id": "task-1", "title": "Task 1"}],
                "edges": [],
                "results": {},
                "task_outputs": {},
                "workspace_context": [],
                "execution_mode": "live",
                "validated_replays_by_task": {},
                "step_execution_modes": {},
                "prompt_overrides": {
                    "task.clarification": {
                        "systemTemplate": "Ask if anything is missing. {{UserLanguage}}"
                    }
                },
                "query": "",
                "current_task_ids": [],
                "completed_task_ids": [],
                "status": "in_progress",
                "error": None,
                "interrupt_payload": None,
                "node_timings": {},
                "evaluation_user_id": "unknown",
                "artifacts_by_port": {},
            },
            {},
        )
    )

    assert result["status"] == "failed"
    assert result["error"] == "sentinel-direct-call"
    assert result["results"]["task-1"]["error"] == "sentinel-direct-call"
    assert updates[-1]["status"] == "failed"
    assert direct_call_system_prompts
    assert "Clarification behavior for task execution:" in direct_call_system_prompts[0]
    assert "ask one concise clarification question" in direct_call_system_prompts[0]
    assert "respond with exactly 'CLEAR'" not in direct_call_system_prompts[0]


def test_build_execution_clarification_guidance_removes_clear_output_contract() -> None:
    guidance = _build_execution_clarification_guidance(
        {"title": "Task 1"},
        "desc",
        {
            "task.clarification": {
                "systemTemplate": "Ask one question when needed. If clear, respond with exactly 'CLEAR'."
            }
        },
        "en",
    )

    assert "If required information is genuinely missing, ask one concise clarification question" in guidance
    assert "If the task is clear, complete the task normally." in guidance
    assert "respond with exactly 'CLEAR'" not in guidance


def test_build_clarification_pre_prompt_includes_missing_requirement_guardrails() -> None:
    prompt = graph_builder_module._build_clarification_pre_prompt(
        {"title": "Analyze company"},
        "Research the company and summarize the latest quarter.",
        {},
        "en",
        user_query="Analyze the latest quarter for the target company.",
        resolved_context="",
    )

    assert "User request:\nAnalyze the latest quarter for the target company." in prompt
    assert "missing company names, time ranges, targets, data sources, deliverable format" in prompt
    assert "Otherwise respond with exactly 'CLEAR'." in prompt


def test_iterator_task_node_executes_direct_child_for_each_item(monkeypatch) -> None:
    prompts = []
    step_updates = []

    async def on_step_update(update):
        step_updates.append(update)

    async def fake_direct_call(*args, **kwargs):
        prompts.append(args[3])
        return f"processed-{len(prompts)}", {
            "input_tokens": 1,
            "output_tokens": 1,
            "total_tokens": 2,
            "model": "test",
        }

    def fake_create_langchain_tools(*args, **kwargs):
        return [], None

    monkeypatch.setattr(
        DynamicGraphBuilder, "_llm_direct_call", staticmethod(fake_direct_call)
    )
    _install_fake_tool_factory(monkeypatch, fake_create_langchain_tools)
    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(LITELLM_API_BASE_URL="", LITELLM_API_SECRET_KEY=""),
    )

    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    iterator = {
        "id": "iterator-1",
        "title": "Iterator",
        "description": "Loop items",
        "task_type": "iterator",
        "task_metadata": {
            "iterator": {
                "source": "items",
                "mode": "item",
                "itemVariable": "current_item",
                "outputVariable": "processed_items",
                "errorStrategy": "stop",
            }
        },
        "output_ports": [
            {"id": "results", "name": "Results", "artifact_kind": "data"},
        ],
    }
    child = {
        "id": "child-1",
        "title": "Child",
        "description": "Process current item",
        "assigned_agent_id": "agent-1",
        "execution_order": 1,
        "input_keys": ["current_item"],
        "output_key": "child_output",
        "task_metadata": {
            "container": {
                "parentIteratorId": "iterator-1",
            }
        },
        "output_ports": [
            {"id": "default", "name": "Default", "artifact_kind": "text"},
        ],
    }
    node = builder._create_task_node("iterator-1", iterator, on_step_update)

    result = asyncio.run(
        node(
            {
                "agents": {
                    "agent-1": {
                        "id": "agent-1",
                        "name": "Agent",
                        "instructions": "Do it",
                        "tools": [],
                    }
                },
                "playbook_id": "pb-1",
                "thread_id": "th-1",
                "tasks": [iterator, child],
                "edges": [],
                "results": {},
                "task_outputs": {"items": ["a", "b"]},
                "workspace_context": [],
                "execution_mode": "live",
                "validated_replays_by_task": {},
                "step_execution_modes": {},
                "prompt_overrides": {},
                "query": "",
                "current_task_ids": [],
                "completed_task_ids": [],
                "status": "in_progress",
                "error": None,
                "interrupt_payload": None,
                "node_timings": {},
                "evaluation_user_id": "unknown",
                "artifacts_by_port": {},
                "node_inputs_by_port": {},
            },
            {},
        )
    )

    aggregate = result["results"]["iterator-1"]["output"]
    assert [item["current_item"] for item in aggregate] == ["a", "b"]
    assert [item["output"] for item in aggregate] == ["processed-1", "processed-2"]
    assert aggregate[0]["child_results"][0]["task_id"] == "child-1"
    assert result["results"]["iterator-1"]["iterator_iterations"][0]["item_preview"] == "a"
    assert "child-1" not in result["results"]
    assert result["task_outputs"]["processed_items"] == aggregate
    projected_results = [
        {
            "index": 0,
            "item_preview": "a",
            "current_item": "a",
            "status": "completed",
            "output": "processed-1",
            "artifacts": [
                {"port_id": "default", "artifact_kind": "text", "content": "processed-1"}
            ],
        },
        {
            "index": 1,
            "item_preview": "b",
            "current_item": "b",
            "status": "completed",
            "output": "processed-2",
            "artifacts": [
                {"port_id": "default", "artifact_kind": "text", "content": "processed-2"}
            ],
        },
    ]
    assert result["results"]["iterator-1"]["artifacts"] == [
        {
            "port_id": "results",
            "artifact_kind": "data",
            "data": projected_results,
            "source_task_id": "iterator-1",
            "source_output_port_id": "results",
        }
    ]
    assert result["artifacts_by_port"] == {
        "iterator-1:results": [
            {
                "port_id": "results",
                "artifact_kind": "data",
                "data": projected_results,
                "source_task_id": "iterator-1",
                "source_output_port_id": "results",
            }
        ]
    }
    assert len(prompts) == 2
    assert "Iterator context JSON:" in prompts[0]
    assert '"iteration_index": 0' in prompts[0]
    assert '"item_variable": "current_item"' in prompts[0]
    assert '"item": "a"' in prompts[0]
    assert '"iteration_index": 1' in prompts[1]
    assert '"item": "b"' in prompts[1]
    assert "Input 'current_item':\na" in prompts[0]
    assert "Input 'current_item':\nb" in prompts[1]
    iterator_updates = [
        update for update in step_updates if update["task_id"] == "iterator-1"
    ]
    assert [update["status"] for update in iterator_updates] == [
        "in_progress",
        "completed",
    ]


def test_iterator_task_node_continue_strategy_records_failed_iteration(monkeypatch) -> None:
    calls = 0

    async def fake_direct_call(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("child boom")
        return "processed", {
            "input_tokens": 1,
            "output_tokens": 1,
            "total_tokens": 2,
            "model": "test",
        }

    def fake_create_langchain_tools(*args, **kwargs):
        return [], None

    monkeypatch.setattr(
        DynamicGraphBuilder, "_llm_direct_call", staticmethod(fake_direct_call)
    )
    _install_fake_tool_factory(monkeypatch, fake_create_langchain_tools)
    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(LITELLM_API_BASE_URL="", LITELLM_API_SECRET_KEY=""),
    )

    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    iterator = {
        "id": "iterator-1",
        "title": "Iterator",
        "description": "Loop items",
        "task_type": "iterator",
        "task_metadata": {
            "iterator": {
                "source": "items",
                "mode": "item",
                "itemVariable": "current_item",
                "outputVariable": "processed_items",
                "errorStrategy": "continue",
            }
        },
    }
    child = {
        "id": "child-1",
        "title": "Child",
        "description": "Process current item",
        "assigned_agent_id": "agent-1",
        "execution_order": 1,
        "input_keys": ["current_item"],
        "task_metadata": {
            "container": {
                "parentIteratorId": "iterator-1",
            }
        },
        "output_ports": [
            {"id": "default", "name": "Default", "artifact_kind": "text"},
        ],
    }
    node = builder._create_task_node("iterator-1", iterator)

    result = asyncio.run(
        node(
            {
                "agents": {
                    "agent-1": {
                        "id": "agent-1",
                        "name": "Agent",
                        "instructions": "Do it",
                        "tools": [],
                    }
                },
                "playbook_id": "pb-1",
                "thread_id": "th-1",
                "tasks": [iterator, child],
                "edges": [],
                "results": {},
                "task_outputs": {"items": ["a", "b"]},
                "workspace_context": [],
                "execution_mode": "live",
                "validated_replays_by_task": {},
                "step_execution_modes": {},
                "prompt_overrides": {},
                "query": "",
                "current_task_ids": [],
                "completed_task_ids": [],
                "status": "in_progress",
                "error": None,
                "interrupt_payload": None,
                "node_timings": {},
                "evaluation_user_id": "unknown",
                "artifacts_by_port": {},
                "node_inputs_by_port": {},
            },
            {},
        )
    )

    aggregate = result["results"]["iterator-1"]["output"]
    assert [item["status"] for item in aggregate] == ["completed", "failed"]
    assert aggregate[0]["output"] == "processed"
    assert aggregate[1]["error"] == "child boom"
    assert calls == 2


def test_iterator_task_node_rejects_ambiguous_output_ports(monkeypatch) -> None:
    def fake_create_langchain_tools(*args, **kwargs):
        return [], None

    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(LITELLM_API_BASE_URL="", LITELLM_API_SECRET_KEY=""),
    )
    _install_fake_tool_factory(monkeypatch, fake_create_langchain_tools)

    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    iterator = {
        "id": "iterator-1",
        "title": "Iterator",
        "description": "Loop items",
        "task_type": "iterator",
        "task_metadata": {
            "iterator": {
                "source": "items",
                "mode": "item",
                "itemVariable": "current_item",
                "outputVariable": "processed_items",
                "errorStrategy": "stop",
            }
        },
        "output_ports": [
            {"id": "results", "name": "Results", "artifact_kind": "data"},
            {"id": "failures", "name": "Failures", "artifact_kind": "data"},
        ],
    }
    node = builder._create_task_node("iterator-1", iterator)

    with pytest.raises(ValueError, match="multiple output ports"):
        asyncio.run(
            node(
                {
                    "agents": {},
                    "playbook_id": "pb-1",
                    "thread_id": "th-1",
                    "tasks": [iterator],
                    "edges": [],
                    "results": {},
                    "task_outputs": {"items": ["a"]},
                    "workspace_context": [],
                    "execution_mode": "live",
                    "validated_replays_by_task": {},
                    "step_execution_modes": {},
                    "prompt_overrides": {},
                    "query": "",
                    "current_task_ids": [],
                    "completed_task_ids": [],
                    "status": "in_progress",
                    "error": None,
                    "interrupt_payload": None,
                    "node_timings": {},
                    "evaluation_user_id": "unknown",
                    "artifacts_by_port": {},
                    "node_inputs_by_port": {},
                },
                {},
            )
        )


def test_iterator_task_node_uses_default_output_port_when_multiple_exist() -> None:
    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    iterator = {
        "id": "iterator-1",
        "title": "Iterator",
        "description": "Loop items",
        "task_type": "iterator",
        "task_metadata": {
            "iterator": {
                "source": "items",
                "mode": "item",
                "itemVariable": "current_item",
                "outputVariable": "processed_items",
                "errorStrategy": "stop",
            }
        },
        "output_ports": [
            {"id": "results", "name": "Results", "artifact_kind": "data"},
            {"id": "default", "name": "Default", "artifact_kind": "data"},
        ],
    }
    node = builder._create_task_node("iterator-1", iterator)

    result = asyncio.run(
        node(
            {
                "agents": {},
                "playbook_id": "pb-1",
                "thread_id": "th-1",
                "tasks": [iterator],
                "edges": [],
                "results": {},
                "task_outputs": {"items": ["a"]},
                "workspace_context": [],
                "execution_mode": "live",
                "validated_replays_by_task": {},
                "step_execution_modes": {},
                "prompt_overrides": {},
                "query": "",
                "current_task_ids": [],
                "completed_task_ids": [],
                "status": "in_progress",
                "error": None,
                "interrupt_payload": None,
                "node_timings": {},
                "evaluation_user_id": "unknown",
                "artifacts_by_port": {},
                "node_inputs_by_port": {},
            },
            {},
        )
    )

    aggregate = result["results"]["iterator-1"]["output"]
    assert result["results"]["iterator-1"]["artifacts"] == [
        {
            "port_id": "default",
            "artifact_kind": "data",
            "data": [
                {
                    "index": 0,
                    "item_preview": "a",
                    "current_item": "a",
                    "status": "completed",
                    "output": "",
                }
            ],
            "source_task_id": "iterator-1",
            "source_output_port_id": "default",
        }
    ]
    assert result["artifacts_by_port"] == {
        "iterator-1:default": [
            {
                "port_id": "default",
                "artifact_kind": "data",
                "data": [
                    {
                        "index": 0,
                        "item_preview": "a",
                        "current_item": "a",
                        "status": "completed",
                        "output": "",
                    }
                ],
                "source_task_id": "iterator-1",
                "source_output_port_id": "default",
            }
        ]
    }


def test_top_level_graph_excludes_iterator_children() -> None:
    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    tasks = [
        {"id": "iterator-1", "execution_order": 1, "task_type": "iterator"},
        {
            "id": "child-1",
            "execution_order": 2,
            "task_metadata": {
                "container": {
                    "parentIteratorId": "iterator-1",
                }
            },
        },
        {"id": "after-1", "execution_order": 3},
    ]
    edges = [
        {"source_id": "__trigger__", "target_id": "iterator-1"},
        {"source_id": "iterator-1", "target_id": "child-1"},
        {"source_id": "child-1", "target_id": "after-1"},
        {"source_id": "iterator-1", "target_id": "after-1"},
    ]

    graph_tasks = builder._get_top_level_tasks(tasks)
    graph_edges = builder._get_top_level_edges(tasks, edges)

    assert [task["id"] for task in graph_tasks] == ["iterator-1", "after-1"]
    assert graph_edges == [
        {"source_id": "__trigger__", "target_id": "iterator-1"},
        {"source_id": "iterator-1", "target_id": "after-1"},
    ]


def test_top_level_graph_maps_external_edges_through_iterator_parent() -> None:
    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    tasks = [
        {"id": "before-1", "execution_order": 1},
        {"id": "iterator-1", "execution_order": 2, "task_type": "iterator"},
        {
            "id": "child-1",
            "execution_order": 3,
            "task_metadata": {
                "container": {
                    "parentIteratorId": "iterator-1",
                }
            },
        },
        {"id": "after-1", "execution_order": 4},
    ]
    edges = [
        {"source_id": "before-1", "target_id": "child-1"},
        {"source_id": "child-1", "target_id": "after-1"},
    ]

    graph_edges = builder._get_top_level_edges(tasks, edges)

    assert graph_edges == [
        {"source_id": "before-1", "target_id": "iterator-1"},
        {"source_id": "iterator-1", "target_id": "after-1"},
    ]


def test_workflow_task_node_skips_reasking_after_user_clarification(monkeypatch) -> None:
    clarification_checks = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        async def ainvoke(self, messages):
            clarification_checks.append(messages)
            return SimpleNamespace(content="CLEAR")

    async def fake_direct_call(*args, **kwargs):
        raise RuntimeError("sentinel-direct-call")

    def fake_create_langchain_tools(*args, **kwargs):
        return [], None

    monkeypatch.setitem(
        sys.modules,
        "langchain_openai",
        SimpleNamespace(ChatOpenAI=FakeChatOpenAI),
    )
    monkeypatch.setattr(
        DynamicGraphBuilder, "_llm_direct_call", staticmethod(fake_direct_call)
    )
    _install_fake_tool_factory(monkeypatch, fake_create_langchain_tools)
    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(LITELLM_API_BASE_URL="", LITELLM_API_SECRET_KEY=""),
    )

    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    node = builder._create_task_node(
        "task-1",
        {
            "id": "task-1",
            "title": "Task 1",
            "description": "desc",
            "assigned_agent_id": "agent-1",
            "allow_clarification": True,
            "max_clarifications": 1,
            "output_key": "task_1_output",
            "output_ports": [
                {"id": "default", "name": "Default", "artifact_kind": "text"},
            ],
        },
    )

    result = asyncio.run(
        node(
            {
                "agents": {
                    "agent-1": {
                        "id": "agent-1",
                        "name": "Agent",
                        "instructions": "Do it",
                        "tools": [],
                    }
                },
                "playbook_id": "pb-1",
                "thread_id": "th-1",
                "tasks": [{"id": "task-1", "title": "Task 1"}],
                "edges": [],
                "results": {},
                "task_outputs": {},
                "workspace_context": [],
                "execution_mode": "live",
                "validated_replays_by_task": {},
                "step_execution_modes": {},
                "prompt_overrides": {},
                "query": "",
                "current_task_ids": [],
                "completed_task_ids": [],
                "status": "in_progress",
                "error": None,
                "interrupt_payload": None,
                "node_timings": {},
                "evaluation_user_id": "unknown",
                "artifacts_by_port": {},
                "clarification_transcripts_by_task": {
                    "task-1": [
                        {"role": "assistant", "content": "Which scope?"},
                        {"role": "user", "content": "Use the latest quarter."},
                    ]
                },
                "task_description_overrides_by_task": {
                    "task-1": "desc\n\nClarification from user: Use the latest quarter."
                },
            },
            {},
        )
    )

    assert result["status"] == "failed"
    assert result["error"] == "sentinel-direct-call"
    assert clarification_checks == []
