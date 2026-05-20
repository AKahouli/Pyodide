import sys
from types import SimpleNamespace

import pytest

from src.langgraph_engine.workflow_service import (
    _build_resume_state_update,
    _build_task_results,
    resume_playbook,
    resume_single_step,
    run_single_step_graph,
)


def _install_fake_tool_factory(monkeypatch, create_langchain_tools) -> None:
    monkeypatch.setitem(
        sys.modules,
        "src.langgraph_engine.playbook_tool_factory",
        SimpleNamespace(create_langchain_tools=create_langchain_tools),
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


@pytest.mark.asyncio
async def test_resume_playbook_rebuilds_graph_when_cache_is_missing(monkeypatch) -> None:
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

    async def fake_get_checkpointer():
        return object()

    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.get_thread_graph",
        lambda _thread_id: None,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.get_checkpointer",
        fake_get_checkpointer,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.get_or_create_graph",
        lambda **_kwargs: {"compiled": FakeGraph()},
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.store_thread_graph",
        lambda _thread_id, _graph: captured.setdefault("stored", True),
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service._extract_interrupt_from_snapshot",
        lambda _snapshot, _thread_id: {
            "type": "approval_request",
            "task_id": "step_1",
            "interrupt_id": "interrupt-1",
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
        human_response={"action": "approve"},
        task_id="step_1",
        interrupt_id="interrupt-1",
        tasks=[{"id": "step_1", "title": "Step 1", "execution_order": 1}],
        edges=[],
    )

    assert response["status"] == "completed"
    assert captured["thread_id"] == "th-1"
    assert captured["stored"] is True


@pytest.mark.asyncio
async def test_resume_playbook_rejects_stale_interrupt_id(monkeypatch) -> None:
    class FakeGraph:
        async def aget_state(self, _config):
            return object()

    async def fake_send_sentinel(_queue) -> None:
        return None

    async def fake_get_or_rebuild(**kwargs):
        return FakeGraph()

    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service._get_or_rebuild_thread_graph",
        fake_get_or_rebuild,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service._extract_interrupt_from_snapshot",
        lambda _snapshot, _thread_id: {
            "type": "approval_request",
            "task_id": "step_1",
            "interrupt_id": "interrupt-2",
        },
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
        human_response={"action": "approve"},
        task_id="step_1",
        interrupt_id="interrupt-1",
    )

    assert response["status"] == "failed"
    assert "Interrupt mismatch" in response["error"]


@pytest.mark.asyncio
async def test_resume_single_step_returns_completed_result_from_task_state(monkeypatch) -> None:
    class FakeGraph:
        async def aget_state(self, _config):
            class Snapshot:
                next = ()
                tasks = []

            return Snapshot()

    monkeypatch.setattr(
        "src.langgraph_engine.graph_cache.get_thread_graph",
        lambda _thread_id: FakeGraph(),
    )
    async def fake_consume_graph_stream(*, graph, graph_input, config, thread_id):
        return None, {
            "status": "in_progress",
            "results": {
                "step_1": {
                    "status": "completed",
                    "output": "done",
                    "components": [{"type": "text", "data": {"content": "done"}}],
                    "tool_trace": [],
                    "usage": None,
                }
            },
        }

    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service._consume_graph_stream",
        fake_consume_graph_stream,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.cleanup_thread_graph",
        lambda _thread_id: None,
    )

    response = await resume_single_step(
        thread_id="th-1",
        task_id="step_1",
        human_response={"action": "reply", "message": "France 90 days"},
    )

    assert response["status"] == "completed"
    assert response["interrupt"] is None
    assert response["result"]["task_id"] == "step_1"
    assert response["result"]["status"] == "completed"
    assert response["result"]["output"] == "done"


@pytest.mark.asyncio
async def test_resume_single_step_preserves_suspended_status_when_interrupt_remains(monkeypatch) -> None:
    class FakeGraph:
        async def aget_state(self, _config):
            class Snapshot:
                next = ("execute",)
                tasks = []

            return Snapshot()

    monkeypatch.setattr(
        "src.langgraph_engine.graph_cache.get_thread_graph",
        lambda _thread_id: FakeGraph(),
    )
    async def fake_consume_graph_stream(*, graph, graph_input, config, thread_id):
        return {
            "type": "clarification",
            "task_id": "step_1",
            "message": "Need scope?",
            "thread_id": thread_id,
        }, {"status": "in_progress", "results": {}}

    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service._consume_graph_stream",
        fake_consume_graph_stream,
    )
    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.cleanup_thread_graph",
        lambda _thread_id: None,
    )

    response = await resume_single_step(
        thread_id="th-1",
        task_id="step_1",
        human_response={"action": "reply", "message": "France 90 days"},
    )

    assert response["status"] == "suspended"
    assert response["interrupt"]["type"] == "clarification"


@pytest.mark.asyncio
async def test_single_step_clarification_resume_completes_with_real_graph(monkeypatch) -> None:
    clarification_calls = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        async def ainvoke(self, messages):
            clarification_calls.append(messages)
            if len(clarification_calls) == 1:
                return SimpleNamespace(content="Which company should I analyze?")
            return SimpleNamespace(content="CLEAR")

    async def fake_direct_call(*args, **kwargs):
        return "Final answer after clarification", {
            "input_tokens": 1,
            "output_tokens": 1,
            "total_tokens": 2,
            "model": "test",
        }

    def fake_create_langchain_tools(*args, **kwargs):
        return [], None

    monkeypatch.setitem(
        sys.modules,
        "langchain_openai",
        SimpleNamespace(ChatOpenAI=FakeChatOpenAI),
    )
    monkeypatch.setattr(
        "src.config.settings.get_settings",
        lambda: SimpleNamespace(LITELLM_API_BASE_URL="", LITELLM_API_SECRET_KEY=""),
    )
    from langgraph.checkpoint.memory import InMemorySaver

    async def fake_get_checkpointer():
        return InMemorySaver()

    monkeypatch.setattr(
        "src.langgraph_engine.workflow_service.get_checkpointer",
        fake_get_checkpointer,
    )
    from src.langgraph_engine.graph_builder import DynamicGraphBuilder

    monkeypatch.setattr(
        DynamicGraphBuilder, "_llm_direct_call", staticmethod(fake_direct_call)
    )
    _install_fake_tool_factory(monkeypatch, fake_create_langchain_tools)

    task = {
        "id": "step_1",
        "title": "Analyze company",
        "description": "Research the company and summarize the latest quarter.",
        "assigned_agent_id": "agent-1",
        "allow_clarification": True,
        "max_clarifications": 1,
        "output_key": "step_1_output",
        "output_ports": [{"id": "default", "name": "Default", "artifact_kind": "text"}],
    }
    agent = {
        "id": "agent-1",
        "name": "Agent",
        "instructions": "Do it",
        "tools": [],
    }

    first = await run_single_step_graph(
        task=task,
        agent=agent,
        context_from_dependencies="Analyze the latest quarter for the target company.",
        prompt_overrides={},
        user_language="en",
    )

    assert first["status"] == "suspended"
    assert first["interrupt"]["type"] == "clarification"
    assert first["interrupt"]["message"] == "Which company should I analyze?"

    resumed = await resume_single_step(
        thread_id=first["thread_id"],
        task_id="step_1",
        human_response={"action": "reply", "message": "Apple"},
    )

    assert resumed["status"] == "completed"
    assert resumed["interrupt"] is None
    assert resumed["result"]["status"] == "completed"
    assert resumed["result"]["output"] == "Final answer after clarification"


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
