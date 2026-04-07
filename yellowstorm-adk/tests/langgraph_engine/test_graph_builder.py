import asyncio
from types import SimpleNamespace

import src.langgraph_engine.graph_builder as graph_builder_module
from src.langgraph_engine.graph_builder import (
    DynamicGraphBuilder,
    _extract_artifacts_from_components,
    _build_default_text_artifact,
    _get_clarification_context,
    _store_clarification_context,
)


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
            }
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
        }
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
    assert [artifact["artifact_kind"] for artifact in artifacts] == ["document", "document"]


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

    restored_transcript, restored_description = _get_clarification_context(state, "task-1")

    assert restored_transcript == transcript
    assert restored_description == description
    assert state["artifacts_by_port"] == {
        "task-1:default": [{
            "port_id": "default",
            "artifact_kind": "text",
            "content": description,
        }],
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

    result = asyncio.run(node({"agents": {}, "playbook_id": "pb-1", "thread_id": "th-1"}, {}))

    assert result["status"] == "failed"
    assert updates
    assert updates[0]["status"] == "failed"
    assert updates[0]["result"]["error"] == "No agent assigned to task task-1"


def test_workflow_task_node_uses_structured_output_artifacts_for_downstream_state(monkeypatch) -> None:
    async def fake_direct_call(*args, **kwargs):
        return "Live preview output", {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2, "model": "test"}

    async def fake_synthesize(*args, **kwargs):
        return [{"output_port_id": "summary", "artifact_kind": "text", "content": "Final summary"}]

    def fake_create_langchain_tools(*args, **kwargs):
        return [], None

    monkeypatch.setattr(graph_builder_module, "_task_requires_structured_output_synthesis", lambda task: True)
    monkeypatch.setattr(graph_builder_module, "_synthesize_structured_outputs", fake_synthesize)
    monkeypatch.setattr(
        graph_builder_module,
        "_build_task_artifacts_from_structured_outputs",
        lambda task, structured_outputs, generated_artifacts: [{
            "port_id": "summary",
            "artifact_kind": "text",
            "content": "Final summary",
        }],
    )
    monkeypatch.setattr(graph_builder_module, "_collect_generated_artifacts", lambda components: [])
    monkeypatch.setattr(DynamicGraphBuilder, "_llm_direct_call", staticmethod(fake_direct_call))
    monkeypatch.setattr(
        "src.langgraph_engine.playbook_tool_factory.create_langchain_tools",
        fake_create_langchain_tools,
    )
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

    result = asyncio.run(node({
        "agents": {"agent-1": {"id": "agent-1", "name": "Agent", "instructions": "Do it", "tools": []}},
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
    }, {}))

    assert result["artifacts_by_port"] == {
        "task-1:summary": [{
            "port_id": "summary",
            "artifact_kind": "text",
            "content": "Final summary",
        }],
    }
    assert result["results"]["task-1"]["artifacts"][0]["port_id"] == "summary"
    assert updates[-1]["result"]["artifacts"][0]["port_id"] == "summary"


def test_workflow_task_node_builds_default_text_artifact_without_explicit_output(monkeypatch) -> None:
    async def fake_direct_call(*args, **kwargs):
        return "", {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2, "model": "test"}

    def fake_create_langchain_tools(*args, **kwargs):
        return [], None

    monkeypatch.setattr(DynamicGraphBuilder, "_llm_direct_call", staticmethod(fake_direct_call))
    monkeypatch.setattr(
        "src.langgraph_engine.playbook_tool_factory.create_langchain_tools",
        fake_create_langchain_tools,
    )
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

    result = asyncio.run(node({
        "agents": {"agent-1": {"id": "agent-1", "name": "Agent", "instructions": "Do it", "tools": []}},
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
    }, {}))

    assert result["artifacts_by_port"] == {
        "task-1:default": [{
            "port_id": "default",
            "artifact_kind": "text",
            "content": "desc",
        }],
    }
    assert updates[-1]["result"]["artifacts"][0]["port_id"] == "default"
