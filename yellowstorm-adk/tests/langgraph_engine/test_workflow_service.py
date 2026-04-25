import pytest

from src.langgraph_engine.workflow_service import (
    _build_resume_state_update,
    run_single_step_graph,
)


def test_build_resume_state_update_restores_clarification_context() -> None:
    update = _build_resume_state_update({
        "type": "clarification",
        "task_id": "step_1",
        "task_description": "Clarified task description",
        "conversation_json": '[{"role": "assistant", "content": "Need scope?"}, {"role": "user", "content": "France 90 days"}]',
    })

    assert update == {
        "clarification_transcripts_by_task": {
            "step_1": [
                {"role": "assistant", "content": "Need scope?"},
                {"role": "user", "content": "France 90 days"},
            ],
        },
        "task_description_overrides_by_task": {
            "step_1": "Clarified task description",
        },
    }


def test_build_resume_state_update_ignores_non_clarification_interrupts() -> None:
    assert _build_resume_state_update({"type": "approval_request", "task_id": "step_1"}) is None


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
