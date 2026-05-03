import pytest

from src.langgraph_engine.workflow_service import (
    _build_resume_state_update,
    _build_task_results,
    resume_playbook,
    run_single_step_graph,
)


def test_build_resume_state_update_skips_clarification_replay() -> None:
    assert _build_resume_state_update(
        {
            "type": "clarification",
            "task_id": "step_1",
            "task_description": "Clarified task description",
            "conversation_json": '[{"role": "assistant", "content": "Need scope?"}, {"role": "user", "content": "France 90 days"}]',
        }
    ) is None


def test_build_resume_state_update_ignores_non_clarification_interrupts() -> None:
    assert _build_resume_state_update({"type": "approval_request", "task_id": "step_1"}) is None


@pytest.mark.asyncio
async def test_resume_playbook_does_not_reinject_clarification_state(monkeypatch) -> None:
    captured = {}

    class FakeGraph:
        async def aget_state(self, _config):
            return object()

    async def fake_send_sentinel(_queue) -> None:
        return None

    async def fake_consume_graph_stream(*, graph, graph_input, config, thread_id):
        captured["graph"] = graph
        captured["graph_input"] = graph_input
        captured["config"] = config
        captured["thread_id"] = thread_id
        return None, {"status": "completed", "tasks": []}

    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.get_thread_graph",
        lambda _thread_id: FakeGraph(),
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service._extract_interrupt_from_snapshot",
        lambda _snapshot, _thread_id: {
            "type": "clarification",
            "task_id": "step_1",
            "task_description": "Clarified task description",
            "conversation_json": '[{"role": "assistant", "content": "Need scope?"}]',
        },
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service._consume_graph_stream",
        fake_consume_graph_stream,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service._send_sentinel",
        fake_send_sentinel,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.remove_queue",
        lambda _thread_id: None,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.cleanup_thread_graph",
        lambda _thread_id: None,
    )

    response = await resume_playbook(
        playbook_id="pb-1",
        thread_id="th-1",
        human_response={"action": "reply", "message": "France 90 days"},
    )

    assert response["status"] == "completed"
    assert captured["graph_input"].update is None
    assert captured["graph_input"].resume == {
        "action": "reply",
        "message": "France 90 days",
    }


def _citation_component(reference: str, source: str, content: str, parent_id: str = ""):
    return {
        "type": "citation",
        "data": {
            "parent_id": parent_id,
            "text_source": {
                "type": "text",
                "source": source,
                "external_id": source.lower().replace(" ", "-"),
                "page": "1",
                "page_content": content,
                "workspace_id": "workspace-1",
                "reference": reference,
            },
        },
    }


def test_build_task_results_normalizes_parallel_citations_in_step_order() -> None:
    tasks = [
        {"id": "step-1", "execution_order": 1},
        {"id": "step-2", "execution_order": 2},
        {"id": "step-3", "execution_order": 3},
    ]
    state = {
        "results": {
            "step-1": {
                "output": "Step 1 answer [1].",
                "components": [
                    {
                        "id": "text-1",
                        "type": "text",
                        "data": {"content": "Step 1 answer [1]."},
                    },
                    _citation_component("1", "Doc A", "A evidence"),
                ],
            },
            "step-2": {
                "output": "Step 2 answer [1].",
                "components": [
                    {
                        "id": "text-2",
                        "type": "text",
                        "data": {"content": "Step 2 answer [1]."},
                    },
                    _citation_component("1", "Doc B", "B evidence"),
                ],
            },
            "step-3": {
                "output": "Step 3 combines [1] and [2], then adds [3].",
                "components": [
                    {
                        "id": "text-3",
                        "type": "text",
                        "data": {
                            "content": "Step 3 combines [1] and [2], then adds [3]."
                        },
                    },
                    _citation_component("1", "Doc A", "A evidence", "old-text"),
                    _citation_component("2", "Doc B", "B evidence", "old-text"),
                    _citation_component("3", "Doc C", "C evidence"),
                ],
            },
        },
        "node_timings": {},
    }

    results = _build_task_results(state, tasks)

    assert results[0]["output"] == "Step 1 answer [1]."
    assert results[1]["output"] == "Step 2 answer [2]."
    assert results[1]["components"][-1]["data"]["text_source"]["reference"] == "2"
    assert results[1]["components"][-1]["data"]["parent_id"] == "text-2"

    step_3_citations = [
        component
        for component in results[2]["components"]
        if component["type"] == "citation"
    ]
    assert results[2]["output"] == "Step 3 combines [1] and [2], then adds [3]."
    assert [
        component["data"]["text_source"]["reference"]
        for component in step_3_citations
    ] == ["1", "2", "3"]
    assert {component["data"]["parent_id"] for component in step_3_citations} == {
        "text-3"
    }


@pytest.mark.asyncio
async def test_run_single_step_graph_preserves_node_inputs_by_port(monkeypatch) -> None:
    captured_state = {}

    async def fake_get_checkpointer():
        return object()

    class FakeStateSnapshot:
        next = []

    class FakeCompiled:
        async def ainvoke(self, initial_state, _config):
            captured_state.update(initial_state)
            return {
                **initial_state,
                "status": "completed",
                "results": {
                    "step_1": {
                        "task_id": "step_1",
                        "status": "completed",
                        "output": "done",
                    }
                },
            }

        async def aget_state(self, _config):
            return FakeStateSnapshot()

    class FakeBuilder:
        def __init__(self, checkpointer=None):
            self.checkpointer = checkpointer

        def build_single_step_graph(self, _task, _agent):
            return {"compiled": FakeCompiled()}

    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.get_checkpointer",
        fake_get_checkpointer,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.graph_builder.DynamicGraphBuilder",
        FakeBuilder,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.store_thread_graph",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.graph_cache.store_thread_graph",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.graph_cache.cleanup_thread_graph",
        lambda *_args, **_kwargs: None,
    )

    node_inputs_by_port = {
        "default": [
            {
                "artifact_kind": "text",
                "content": "previous upstream output",
                "source_task_id": "upstream_1",
                "source_output_port_id": "default",
            }
        ]
    }

    result = await run_single_step_graph(
        task={"id": "step_1", "assigned_agent_id": "agent_1"},
        agent={"id": "agent_1", "name": "Agent"},
        edges=[
            {
                "source_id": "upstream_1",
                "target_id": "step_1",
                "source_output_port_id": "default",
                "target_input_port_id": "default",
            }
        ],
        upstream_results=[],
        artifacts_by_port={},
        node_inputs_by_port=node_inputs_by_port,
        execution_mode="replay_flex",
    )

    assert result["status"] == "completed"
    assert captured_state["node_inputs_by_port"] == node_inputs_by_port
    assert captured_state["artifacts_by_port"] == {}
