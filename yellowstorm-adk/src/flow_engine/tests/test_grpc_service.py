import asyncio

import pytest
from google.protobuf.json_format import ParseDict

from src.flow_engine.grpc_service import _run_request_log_context, _snapshot_hitl_blockers, _snapshot_hitl_policy
from src.flow_engine.grpc_contract import (
    snapshot_to_dict,
    should_emit_fallback_completion,
    struct_to_dict,
    unwrap_metadata_fields,
    value_to_python,
)

struct_pb2 = pytest.importorskip("google.protobuf.struct_pb2", reason="protobuf not available")


def test_run_request_log_context_excludes_prompts_and_input_values():
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    input_context = struct_pb2.Struct()
    ParseDict({"privateInput": "customer-secret-value"}, input_context)
    request = pb.RunRequest(
        execution_id="exec-1",
        flow_id="flow-1",
        input_context=input_context,
        settings=pb.RunSettings(
            playbook_planner=pb.PlannerAgentSnapshot(system_prompt="private-planner-prompt"),
        ),
    )

    context = _run_request_log_context(request, {"nodes": []}, {"privateInput": "customer-secret-value"})
    serialized = str(context)

    assert context["input_context_keys"] == ["privateInput"]
    assert "customer-secret-value" not in serialized
    assert "private-planner-prompt" not in serialized


def test_snapshot_hitl_policy_reads_node_metadata_fallback():
    snapshot = {
        "nodes": [{
            "id": "step-1",
            "metadata": {"hitl_policy": {"mode": "auto", "clarificationEnabled": True}},
        }],
    }

    assert _snapshot_hitl_policy(snapshot) == {"mode": "auto", "clarificationEnabled": True}


def test_snapshot_hitl_blockers_reads_deduped_node_metadata_fallback():
    blocker = {"id": "custom-rule", "kind": "custom", "createdBy": "user"}
    snapshot = {
        "nodes": [
            {"id": "step-1", "metadata": {"hitl_blockers": [blocker]}},
            {"id": "step-2", "metadata": {"hitl_blockers": [blocker]}},
        ],
    }

    assert _snapshot_hitl_blockers(snapshot) == [blocker]


def test_snapshot_hitl_blockers_filters_out_system_blockers():
    snapshot = {
        "hitl_blockers": [
            {"id": "system-rule", "kind": "custom", "createdBy": "system"},
            {"id": "user-rule", "kind": "custom", "createdBy": "user"},
        ],
    }

    assert _snapshot_hitl_blockers(snapshot) == [
        {"id": "user-rule", "kind": "custom", "createdBy": "user"},
    ]


class TestUnwrapMetadataFields:
    def test_flat_dict_passes_through(self):
        d = {"assignedAgentId": "abc", "custom_key": "value"}
        assert unwrap_metadata_fields(d) == d

    def test_wrapped_fields_unwrapped(self):
        d = {"fields": {"assignedAgentId": "abc"}}
        assert unwrap_metadata_fields(d) == {"assignedAgentId": "abc"}

    def test_nested_agent_fields_unwrapped(self):
        d = {"fields": {"assignedAgentId": "abc", "agent": {"fields": {"model": "gpt-5.4-mini", "prompt": "Do the thing"}}}}
        expected = {"assignedAgentId": "abc", "agent": {"model": "gpt-5.4-mini", "prompt": "Do the thing"}}
        assert unwrap_metadata_fields(d) == expected

    def test_agent_without_fields_passes_through(self):
        d = {"fields": {"agent": {"model": "direct", "prompt": "sys"}}}
        expected = {"agent": {"model": "direct", "prompt": "sys"}}
        assert unwrap_metadata_fields(d) == expected

    def test_arbitrary_nested_object_unwrapped(self):
        d = {"fields": {"label": "my node", "toolConfig": {"fields": {"timeout": 30}}}}
        expected = {"label": "my node", "toolConfig": {"timeout": 30}}
        assert unwrap_metadata_fields(d) == expected

    def test_no_fields_key_passes_through(self):
        d = {"agent": {"model": "gpt-4"}, "label": "test"}
        assert unwrap_metadata_fields(d) == d

    def test_empty_dict(self):
        assert unwrap_metadata_fields({}) == {}

    def test_fields_only_unwrapped(self):
        assert unwrap_metadata_fields({"fields": {}}) == {}


class TestValueToPython:
    def test_null_value(self):
        v = struct_pb2.Value(null_value=0)
        assert value_to_python(v) is None

    def test_number_value(self):
        v = struct_pb2.Value(number_value=3.14)
        assert value_to_python(v) == 3.14

    def test_string_value(self):
        v = struct_pb2.Value(string_value="hello")
        assert value_to_python(v) == "hello"

    def test_bool_value_true(self):
        v = struct_pb2.Value(bool_value=True)
        assert value_to_python(v) is True

    def test_bool_value_false(self):
        v = struct_pb2.Value(bool_value=False)
        assert value_to_python(v) is False

    def test_list_value(self):
        v = struct_pb2.Value()
        v.list_value.values.add().string_value = "a"
        v.list_value.values.add().number_value = 1
        assert value_to_python(v) == ["a", 1]

    def test_struct_value(self):
        inner = struct_pb2.Struct()
        inner.fields["x"].number_value = 10
        inner.fields["y"].string_value = "hi"

        v = struct_pb2.Value()
        v.struct_value.CopyFrom(inner)
        assert value_to_python(v) == {"x": 10, "y": "hi"}


class TestStructToDict:
    def test_none_input(self):
        assert struct_to_dict(None) == {}

    def test_empty_struct(self):
        s = struct_pb2.Struct()
        assert struct_to_dict(s) == {}

    def test_flat_struct(self):
        s = struct_pb2.Struct()
        s.fields["a"].string_value = "x"
        s.fields["b"].number_value = 42
        s.fields["c"].bool_value = True
        assert struct_to_dict(s) == {"a": "x", "b": 42, "c": True}

    def test_nested_struct(self):
        inner = struct_pb2.Struct()
        inner.fields["key"].string_value = "val"
        outer = struct_pb2.Struct()
        outer.fields["nested"].struct_value.CopyFrom(inner)
        assert struct_to_dict(outer) == {"nested": {"key": "val"}}

    def test_preserves_user_fields_key(self):
        inner = struct_pb2.Struct()
        inner.fields["x"].number_value = 1
        outer = struct_pb2.Struct()
        outer.fields["fields"].struct_value.CopyFrom(inner)
        assert struct_to_dict(outer) == {"fields": {"x": 1}}


class TestSnapshotConversion:
    def test_snapshot_to_dict_preserves_metadata_fields_key(self):
        pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
        snapshot = pb.FlowSnapshot()
        node = snapshot.nodes.add()
        node.id = "node-1"
        node.kind = "step"
        nested = struct_pb2.Struct()
        nested.fields["safe"].bool_value = True
        node.metadata.fields["fields"].struct_value.CopyFrom(nested)

        converted = snapshot_to_dict(snapshot)
        assert converted["nodes"][0]["metadata"] == {"fields": {"safe": True}}

    def test_snapshot_to_dict_preserves_node_description_metadata(self):
        pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
        snapshot = pb.FlowSnapshot()
        node = snapshot.nodes.add()
        node.id = "node-1"
        node.kind = "step"
        node.metadata.fields["description"].string_value = "Summarize the source material."
        port = node.output.ports.add()
        port.id = "summary"
        port.label = "Summary"
        port.type = "text"

        converted = snapshot_to_dict(snapshot)

        assert converted["nodes"][0]["metadata"]["description"] == "Summarize the source material."
        assert converted["nodes"][0]["output"]["ports"][0]["id"] == "summary"

    def test_snapshot_to_dict_preserves_agent_tool_metadata(self):
        pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
        snapshot = pb.FlowSnapshot()
        node = snapshot.nodes.add()
        node.id = "node-1"
        node.kind = "step"
        ParseDict(
            {
                "agent_tools": [{"name": "calculator", "description": "Math helper"}],
                "agent_params": {"user_id": "user-1"},
                "connector_bindings": [{"connector_id": "conn-1", "actions": [{"action_key": "search"}]}],
            },
            node.metadata,
        )

        converted = snapshot_to_dict(snapshot)

        assert converted["nodes"][0]["metadata"]["agent_tools"] == [{"name": "calculator", "description": "Math helper"}]
        assert converted["nodes"][0]["metadata"]["agent_params"] == {"user_id": "user-1"}
        assert converted["nodes"][0]["metadata"]["connector_bindings"] == [{"connector_id": "conn-1", "actions": [{"action_key": "search"}]}]

    def test_snapshot_to_dict_preserves_control_edge_handle_fields(self):
        pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
        snapshot = pb.FlowSnapshot()
        edge = snapshot.control_edges.add()
        edge.id = "edge-1"
        edge.kind = "sequential"
        edge.source = "step-1"
        edge.target = "step-2"
        edge.source_output_port_id = "summary"
        edge.target_input_port_id = "prompt"

        converted = snapshot_to_dict(snapshot)

        assert converted["control_edges"][0]["source_output_port_id"] == "summary"
        assert converted["control_edges"][0]["target_input_port_id"] == "prompt"


def test_should_emit_fallback_completion_only_without_terminal_event():
    assert should_emit_fallback_completion(False) is True
    assert should_emit_fallback_completion(True) is False


def test_run_uses_request_settings(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request = pb.RunRequest(execution_id="exec-1", flow_id="flow-1")
        request.settings.recursion_limit = 7
        request.settings.max_parallelism = 3
        request.snapshot.settings.recursion_limit = 99
        request.snapshot.settings.max_parallelism = 99

        captured: dict[str, object] = {}

        async def fake_ensure_checkpointer():
            return object()

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", lambda snapshot, checkpointer: object())

        async def fake_stream_graph(graph, graph_input, recursion_limit=25, max_parallelism=None, config=None):
            captured["graph_input"] = graph_input
            captured["recursion_limit"] = recursion_limit
            captured["max_parallelism"] = max_parallelism
            captured["config"] = config
            if False:
                yield {}

        async def fake_emit_events(execution_id, event_stream):
            async for _ in event_stream:
                pass
            if False:
                yield None

        monkeypatch.setattr("src.flow_engine.grpc_service.stream_graph", fake_stream_graph)
        monkeypatch.setattr("src.flow_engine.grpc_service.emit_events", fake_emit_events)

        events = [event async for event in servicer.Run(request, None)]

        assert captured["recursion_limit"] == 7
        assert captured["max_parallelism"] == 3
        assert captured["config"] == {"configurable": {"thread_id": "exec-1"}}
        assert events[-1].event_type == "ExecutionCompleted"

    asyncio.run(_run_test())


def test_run_does_not_emit_duplicate_completion(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer
    from src.flow_engine.runtime.events import _build_event

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request = pb.RunRequest(execution_id="exec-dup", flow_id="flow-dup")

        async def fake_ensure_checkpointer():
            return object()

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", lambda snapshot, checkpointer: object())

        async def fake_stream_graph(graph, graph_input, recursion_limit=25, max_parallelism=None, config=None):
            if False:
                yield {}

        async def fake_emit_events(execution_id, event_stream):
            async for _ in event_stream:
                pass
            yield _build_event("ExecutionCompleted", execution_id, "", {}, 0)

        monkeypatch.setattr("src.flow_engine.grpc_service.stream_graph", fake_stream_graph)
        monkeypatch.setattr("src.flow_engine.grpc_service.emit_events", fake_emit_events)

        events = [event async for event in servicer.Run(request, None)]
        assert [event.event_type for event in events].count("ExecutionCompleted") == 1

    asyncio.run(_run_test())


def test_run_seeds_task_outputs_from_request(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request = pb.RunRequest(execution_id="exec-seeded", flow_id="flow-seeded")
        seeded = request.seeded_task_outputs.add()
        seeded.node_id = "source-1"
        seeded.iteration = 2
        ParseDict(
            {
                "output": "seeded summary",
                "outputs": {
                    "summary": {"content": "seeded summary"},
                },
                "artifacts": [{"port_id": "summary", "artifact_kind": "text", "content": "seeded summary"}],
            },
            seeded.payload,
        )

        captured: dict[str, object] = {}

        async def fake_ensure_checkpointer():
            return object()

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", lambda snapshot, checkpointer: object())

        async def fake_stream_graph(graph, graph_input, recursion_limit=25, max_parallelism=None, config=None):
            captured["graph_input"] = graph_input
            if False:
                yield {}

        async def fake_emit_events(execution_id, event_stream):
            async for _ in event_stream:
                pass
            if False:
                yield None

        monkeypatch.setattr("src.flow_engine.grpc_service.stream_graph", fake_stream_graph)
        monkeypatch.setattr("src.flow_engine.grpc_service.emit_events", fake_emit_events)

        events = [event async for event in servicer.Run(request, None)]

        assert captured["graph_input"]["task_outputs"] == {
            ("source-1", 2): {
                "output": "seeded summary",
                "outputs": {"summary": {"content": "seeded summary"}},
                "artifacts": [{"port_id": "summary", "artifact_kind": "text", "content": "seeded summary"}],
            },
        }
        assert captured["graph_input"]["iterations"] == {"source-1": 3}
        assert events[-1].event_type == "ExecutionCompleted"

    asyncio.run(_run_test())


def test_run_seeds_hitl_memory_from_request(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request = pb.RunRequest(execution_id="exec-hitl-memory", flow_id="flow-hitl-memory")
        ParseDict(
            {
                "__playbook_hitl_memory": [{
                    "id": "memory-1",
                    "node_id": "step-1",
                    "memory_type": "procedural",
                    "title": "Use CSV exports",
                    "normalized_instruction": "Prefer CSV exports for this step.",
                    "content": "Prefer CSV exports for this step.",
                    "applies_to": "node",
                    "sensitivity": "normal",
                }],
                "brief": "run it",
            },
            request.input_context,
        )

        captured: dict[str, object] = {}

        async def fake_ensure_checkpointer():
            return object()

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", lambda snapshot, checkpointer: object())

        async def fake_stream_graph(graph, graph_input, recursion_limit=25, max_parallelism=None, config=None):
            captured["graph_input"] = graph_input
            if False:
                yield {}

        async def fake_emit_events(execution_id, event_stream):
            async for _ in event_stream:
                pass
            if False:
                yield None

        monkeypatch.setattr("src.flow_engine.grpc_service.stream_graph", fake_stream_graph)
        monkeypatch.setattr("src.flow_engine.grpc_service.emit_events", fake_emit_events)

        events = [event async for event in servicer.Run(request, None)]

        assert captured["graph_input"]["inputs"] == {"brief": "run it"}
        assert captured["graph_input"]["hitl_memory"] == [{
            "id": "memory-1",
            "node_id": "step-1",
            "memory_type": "procedural",
            "title": "Use CSV exports",
            "normalized_instruction": "Prefer CSV exports for this step.",
            "content": "Prefer CSV exports for this step.",
            "applies_to": "node",
            "sensitivity": "normal",
        }]
        assert events[-1].event_type == "ExecutionCompleted"

    asyncio.run(_run_test())


def test_resume_approval_unblocks_run(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer
    from src.flow_engine.runtime.events import _build_event

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request = pb.RunRequest(execution_id="exec-2", flow_id="flow-2")

        async def fake_ensure_checkpointer():
            return object()

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", lambda snapshot, checkpointer: object())

        phase = {"value": 0}

        async def fake_stream_graph(graph, graph_input, recursion_limit=25, max_parallelism=None, config=None):
            yield {"phase": phase["value"]}

        async def fake_emit_events(execution_id, event_stream):
            async for _ in event_stream:
                pass
            if phase["value"] == 0:
                phase["value"] = 1
                yield _build_event("ApprovalRequested", execution_id, "approval-node", {"prompt": "Approve?"}, 0)
            else:
                yield _build_event("ApprovalRequested", execution_id, "approval-node", {"prompt": "Approve?"}, 0)
                yield _build_event("ApprovalResolved", execution_id, "approval-node", {"decision": {"decision": "approved"}}, 0)
                yield _build_event("NodeStarted", execution_id, "downstream-node", {"label": "Follow up"}, 0)
                yield _build_event("NodeCompleted", execution_id, "downstream-node", {"output": "done"}, 0)

        monkeypatch.setattr("src.flow_engine.grpc_service.stream_graph", fake_stream_graph)
        monkeypatch.setattr("src.flow_engine.grpc_service.emit_events", fake_emit_events)

        collected = []
        approval_seen = asyncio.Event()

        async def consume_run():
            async for event in servicer.Run(request, None):
                collected.append(event.event_type)
                if event.event_type == "ApprovalRequested":
                    approval_seen.set()

        run_task = asyncio.create_task(consume_run())
        await approval_seen.wait()

        response = await servicer.ResumeApproval(
            pb.ResumeApprovalRequest(execution_id="exec-2", decision="approved"),
            None,
        )
        await run_task

        assert response.resumed is True
        assert collected == [
            "ApprovalRequested",
            "ApprovalResolved",
            "NodeStarted",
            "NodeCompleted",
            "ExecutionCompleted",
        ]

    asyncio.run(_run_test())


def test_resume_approval_rejects_duplicate_resume():
    pytest.importorskip("langgraph", reason="langgraph not installed")
    from langgraph.types import Command
    from src.flow_engine.grpc_service import _ActiveExecution

    active = _ActiveExecution(graph=object(), config={})
    active.waiting_for_approval = True

    first = active.set_resume_input(Command(resume={"decision": "approved", "payload": {}}))
    second = active.set_resume_input(Command(resume={"decision": "rejected", "payload": {}}))

    assert first is True
    assert second is False


def test_resume_from_step_unblocks_run(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer
    from src.flow_engine.runtime.events import _build_event

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request = pb.RunRequest(execution_id="exec-step", flow_id="flow-step")

        async def fake_ensure_checkpointer():
            return object()

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", lambda snapshot, checkpointer: object())

        phase = {"value": 0}

        async def fake_stream_graph(graph, graph_input, recursion_limit=25, max_parallelism=None, config=None):
            yield {"phase": phase["value"], "graph_input": graph_input}

        async def fake_emit_events(execution_id, event_stream):
            async for _ in event_stream:
                pass
            if phase["value"] == 0:
                phase["value"] = 1
                yield _build_event(
                    "NodeSuspended",
                    execution_id,
                    "step-1",
                    {"interrupt_id": "step-1:approval_request:1", "message": "Approve step", "resumable_actions": ["approve", "reject", "skip"]},
                    0,
                )
            else:
                yield _build_event(
                    "NodeSuspended",
                    execution_id,
                    "step-1",
                    {"interrupt_id": "step-1:approval_request:1", "message": "Approve step", "resumable_actions": ["approve", "reject", "skip"]},
                    0,
                )
                yield _build_event("NodeStarted", execution_id, "step-2", {"label": "Continue"}, 0)
                yield _build_event("NodeCompleted", execution_id, "step-2", {"output": "done"}, 0)

        monkeypatch.setattr("src.flow_engine.grpc_service.stream_graph", fake_stream_graph)
        monkeypatch.setattr("src.flow_engine.grpc_service.emit_events", fake_emit_events)

        collected = []
        suspended_seen = asyncio.Event()

        async def consume_run():
            async for event in servicer.Run(request, None):
                collected.append(event.event_type)
                if event.event_type == "NodeSuspended":
                    suspended_seen.set()

        run_task = asyncio.create_task(consume_run())
        await suspended_seen.wait()

        response = await servicer.ResumeFromStep(
            pb.ResumeFromStepRequest(
                execution_id="exec-step",
                node_id="step-1",
                iteration=0,
                interrupt_id="step-1:approval_request:1",
                action="approve",
            ),
            None,
        )
        await run_task

        assert response.resumed is True
        assert collected == [
            "NodeSuspended",
            "NodeStarted",
            "NodeCompleted",
            "ExecutionCompleted",
        ]

    asyncio.run(_run_test())


def test_resume_from_step_rejects_wrong_interrupt():
    pytest.importorskip("langgraph", reason="langgraph not installed")
    from langgraph.types import Command
    from src.flow_engine.grpc_service import _ActiveExecution

    active = _ActiveExecution(graph=object(), config={})
    active.waiting_for_step_resume = True
    active.pending_interrupt = {
        "node_id": "step-1",
        "iteration": 0,
        "interrupt_id": "interrupt-1",
    }

    accepted = active.set_step_resume_input(
        Command(resume={"action": "approve"}),
        node_id="step-1",
        iteration=0,
        interrupt_id="interrupt-2",
    )

    assert accepted is False


def test_step_resume_survives_unrelated_events():
    pytest.importorskip("langgraph", reason="langgraph not installed")
    from src.flow_engine.grpc_service import _ActiveExecution

    active = _ActiveExecution(graph=object(), config={})
    active.waiting_for_step_resume = True
    active.pending_interrupt = {
        "node_id": "step-1",
        "iteration": 0,
        "interrupt_id": "interrupt-1",
    }

    assert active.should_clear_step_resume("step-2", 0) is False
    assert active.should_clear_step_resume("step-1", 1) is False
    assert active.should_clear_step_resume("step-1", 0) is True


def test_seed_replay_state_returns_none_when_no_source_state(monkeypatch):
    from src.flow_engine.grpc_service import _seed_replay_state

    class FakeState:
        values = None
        next = ()

    class FakeGraph:
        def __init__(self):
            self.state_updates = []

        async def aget_state(self, config):
            return FakeState()

    result = asyncio.run(_seed_replay_state(
        FakeGraph(), object(), "exec-new", "exec-src",
        {"control_edges": [], "nodes": []}, {}, "step-1", 0,
    ))
    assert result is None


def test_seed_replay_state_prefers_historical_checkpoint_fork(monkeypatch):
    from src.flow_engine.grpc_service import _seed_replay_state

    class FakeState:
        def __init__(self, values=None, next_nodes=(), config=None, parent_config=None):
            self.values = values or {}
            self.next = next_nodes
            self.config = config
            self.parent_config = parent_config

    class FakeCheckpointTuple:
        def __init__(self):
            self.config = {
                "configurable": {
                    "thread_id": "exec-src",
                    "checkpoint_ns": "",
                    "checkpoint_id": "cp-target",
                },
            }
            self.checkpoint = {
                "v": 1,
                "ts": "2026-05-29T00:00:00Z",
                "id": "cp-target",
                "channel_values": {"foo": "bar"},
                "channel_versions": {"__start__": 1},
                "versions_seen": {"__input__": {}},
                "pending_sends": [],
            }
            self.metadata = {"step": 3, "parents": {}}
            self.parent_config = {
                "configurable": {
                    "thread_id": "exec-src",
                    "checkpoint_ns": "",
                    "checkpoint_id": "cp-parent",
                },
            }
            self.pending_writes = [("task-123", "channel-a", {"hello": "world"})]

    class FakeCheckpointer:
        def __init__(self):
            self.aput_calls = []
            self.aput_writes_calls = []

        async def aget_tuple(self, config):
            checkpoint_id = config.get("configurable", {}).get("checkpoint_id")
            if checkpoint_id == "cp-target":
                return FakeCheckpointTuple()
            return None

        async def aput(self, config, checkpoint, metadata, new_versions):
            self.aput_calls.append({
                "config": config,
                "checkpoint": checkpoint,
                "metadata": metadata,
                "new_versions": new_versions,
            })
            return {
                "configurable": {
                    "thread_id": config["configurable"]["thread_id"],
                    "checkpoint_ns": config["configurable"].get("checkpoint_ns", ""),
                    "checkpoint_id": checkpoint["id"],
                },
            }

        async def aput_writes(self, config, writes, task_id, task_path=""):
            self.aput_writes_calls.append({
                "config": config,
                "writes": writes,
                "task_id": task_id,
                "task_path": task_path,
            })

    class FakeGraph:
        def __init__(self):
            self.state_updates = []

        async def aget_state(self, config):
            checkpoint_id = config.get("configurable", {}).get("checkpoint_id")
            if checkpoint_id == "cp-current":
                return FakeState(
                    values={"iterations": {"target": 1}},
                    next_nodes=("downstream",),
                    config=config,
                    parent_config={
                        "configurable": {
                            "thread_id": "exec-src",
                            "checkpoint_ns": "",
                            "checkpoint_id": "cp-target",
                        },
                    },
                )
            if checkpoint_id == "cp-target":
                return FakeState(
                    values={"iterations": {"target": 0}},
                    next_nodes=("target",),
                    config=config,
                    parent_config={
                        "configurable": {
                            "thread_id": "exec-src",
                            "checkpoint_ns": "",
                            "checkpoint_id": "cp-parent",
                        },
                    },
                )
            if config.get("configurable", {}).get("thread_id") == "exec-src":
                return FakeState(
                    values={"iterations": {"target": 1}},
                    next_nodes=("downstream",),
                    config={
                        "configurable": {
                            "thread_id": "exec-src",
                            "checkpoint_ns": "",
                            "checkpoint_id": "cp-current",
                        },
                    },
                    parent_config={
                        "configurable": {
                            "thread_id": "exec-src",
                            "checkpoint_ns": "",
                            "checkpoint_id": "cp-target",
                        },
                    },
                )
            raise AssertionError(f"Unexpected config: {config}")

        async def aupdate_state(self, config, values, as_node=None):
            self.state_updates.append({
                "config": config,
                "values": values,
                "as_node": as_node,
            })
            return config

        async def abulk_update_state(self, config, supersteps):
            raise AssertionError("fallback bulk replay should not run when historical checkpoint fork succeeds")

        async def astream(self, graph_input, config, **kwargs):
            raise AssertionError("fallback bootstrap should not run when historical checkpoint fork succeeds")

    checkpointer = FakeCheckpointer()
    graph = FakeGraph()
    result = asyncio.run(_seed_replay_state(
        graph, checkpointer, "exec-new", "exec-src",
        {
            "control_edges": [],
            "nodes": [{"id": "target", "kind": "step"}, {"id": "downstream", "kind": "step"}],
        },
        {},
        "target",
        0,
    ))

    assert result == {
        "configurable": {
            "thread_id": "exec-new",
            "checkpoint_ns": "",
            "checkpoint_id": "cp-target",
        },
    }
    assert checkpointer.aput_calls == [{
        "config": {"configurable": {"thread_id": "exec-new", "checkpoint_ns": ""}},
        "checkpoint": {
            "v": 1,
            "ts": "2026-05-29T00:00:00Z",
            "id": "cp-target",
            "channel_values": {"foo": "bar"},
            "channel_versions": {"__start__": 1},
            "versions_seen": {"__input__": {}},
            "pending_sends": [],
            "updated_channels": None,
        },
        "metadata": {"source": "fork", "step": 3, "parents": {}},
        "new_versions": {},
    }]
    assert checkpointer.aput_writes_calls == [{
        "config": {"configurable": {"thread_id": "exec-new", "checkpoint_ns": "", "checkpoint_id": "cp-target"}},
        "writes": [("channel-a", {"hello": "world"})],
        "task_id": "task-123",
        "task_path": "",
    }]
    assert graph.state_updates == [{
        "config": {"configurable": {"thread_id": "exec-new", "checkpoint_ns": "", "checkpoint_id": "cp-target"}},
        "values": {"hitl_memory": []},
        "as_node": "__input__",
    }]


def test_seed_replay_state_pre_completes_upstream_nodes(monkeypatch):
    from src.flow_engine.grpc_service import _seed_replay_state

    class FakeState:
        def __init__(self, values=None, next_nodes=()):
            self.values = values or {}
            self.next = next_nodes

    state_map = {}

    class FakeGraph:
        def __init__(self):
            self.bulk_updates = []

        async def aget_state(self, config):
            tid = config.get("configurable", {}).get("thread_id", "")
            if tid == "exec-src":
                return FakeState(
                    values={
                        "task_outputs": {("upstream-1", 0): {"out": "a"}, ("target", 0): {"out": "b"}},
                        "iterations": {"upstream-1": 1, "target": 1},
                        "router_decisions": {},
                        "errors": [],
                    },
                    next_nodes=(),
                )
            if tid == "exec-new" and not state_map.get("upstream_done"):
                return FakeState(values={"execution_id": tid}, next_nodes=("upstream-1",))
            return FakeState(values={"execution_id": tid}, next_nodes=("target",))

        async def aupdate_state(self, config, values, as_node=None):
            if as_node == "__input__":
                return config
            if as_node == "upstream-1":
                state_map["upstream_done"] = True
            return config

        async def abulk_update_state(self, config, supersteps):
            self.bulk_updates.append(supersteps)
            for values, as_node in supersteps[0]:
                if as_node == "upstream-1":
                    state_map["upstream_done"] = True
            return config

        async def astream(self, graph_input, config, **kwargs):
            yield {}

    graph = FakeGraph()
    result = asyncio.run(_seed_replay_state(
        graph, object(), "exec-new", "exec-src",
        {
            "control_edges": [
                {"source": "upstream-1", "target": "target"},
            ],
            "nodes": [
                {"id": "upstream-1", "kind": "step"},
                {"id": "target", "kind": "step"},
            ],
        },
        {},
        "target",
        0,
    ))
    assert result is not None
    assert graph.bulk_updates == [[ [({"task_outputs": {("upstream-1", 0): {"out": "a"}}, "iterations": {"upstream-1": 1}}, "upstream-1")] ]]


def test_seed_replay_state_does_not_bootstrap_with_astream(monkeypatch):
    from src.flow_engine.grpc_service import _seed_replay_state

    class FakeState:
        def __init__(self, values=None, next_nodes=()):
            self.values = values or {}
            self.next = next_nodes

    captured = {"astream_called": False}

    class FakeGraph:
        async def aget_state(self, config):
            tid = config.get("configurable", {}).get("thread_id", "")
            if tid == "exec-src":
                return FakeState(
                    values={
                        "task_outputs": {("upstream-1", 0): {"out": "a"}, ("target", 0): {"out": "b"}},
                        "iterations": {"upstream-1": 1, "target": 1},
                        "router_decisions": {},
                        "flow_id": "flow-1",
                        "inputs": {"foo": "bar"},
                    },
                )
            return FakeState(values={"execution_id": tid}, next_nodes=("target",))

        async def aupdate_state(self, config, values, as_node=None):
            if as_node == "__input__":
                captured["seed_values"] = values
            return config

        async def abulk_update_state(self, config, supersteps):
            return config

        async def astream(self, graph_input, config, **kwargs):
            captured["astream_called"] = True
            yield {}

    result = asyncio.run(_seed_replay_state(
        FakeGraph(), object(), "exec-new", "exec-src",
        {
            "control_edges": [
                {"source": "upstream-1", "target": "target"},
            ],
            "nodes": [
                {"id": "upstream-1", "kind": "step"},
                {"id": "target", "kind": "step"},
            ],
        },
        {},
        "target",
        0,
    ))

    assert result is not None
    assert captured["astream_called"] is False
    assert captured["seed_values"]["flow_id"] == "flow-1"
    assert captured["seed_values"]["inputs"] == {"foo": "bar"}


def test_seed_replay_state_filters_human_context_by_scope(monkeypatch):
    from src.flow_engine.grpc_service import _seed_replay_state

    class FakeState:
        def __init__(self, values=None, next_nodes=()):
            self.values = values or {}
            self.next = next_nodes

    captured = {}

    class FakeGraph:
        async def aget_state(self, config):
            tid = config.get("configurable", {}).get("thread_id", "")
            if tid == "exec-src":
                return FakeState(
                    values={
                        "task_outputs": {("upstream", 0): {"out": "a"}},
                        "iterations": {"upstream": 1},
                        "router_decisions": {},
                        "human_context": [
                            {"id": "entire-upstream", "scope": "entire_run", "node_id": "upstream"},
                            {"id": "entire-target", "scope": "entire_run", "node_id": "target"},
                            {"id": "entire-downstream", "scope": "entire_run", "node_id": "downstream"},
                            {"id": "entire-unknown", "scope": "entire_run"},
                            {"id": "upstream", "scope": "downstream_run", "node_id": "upstream"},
                            {"id": "target", "scope": "downstream_run", "node_id": "target"},
                            {"id": "step", "scope": "step_only", "node_id": "upstream"},
                            {"id": "future-node", "scope": "future_node_runs", "node_id": "upstream"},
                            {"id": "future-flow", "scope": "future_workflow_runs", "node_id": "upstream"},
                            {"id": "invalid", "scope": "downstream_run"},
                            "not-a-context-entry",
                        ],
                    },
                )
            return FakeState(values={"execution_id": tid}, next_nodes=("target",))

        async def aupdate_state(self, config, values, as_node=None):
            if as_node == "__input__":
                captured["state_update"] = values
            return config

        async def abulk_update_state(self, config, supersteps):
            return config

    result = asyncio.run(_seed_replay_state(
        FakeGraph(), object(), "exec-new", "exec-src",
        {
            "control_edges": [
                {"source": "upstream", "target": "target"},
                {"source": "target", "target": "downstream"},
            ],
            "nodes": [
                {"id": "upstream", "kind": "step"},
                {"id": "target", "kind": "step"},
                {"id": "downstream", "kind": "step"},
            ],
        },
        {},
        "target",
        0,
    ))

    assert result is not None
    assert captured["state_update"]["human_context"] == [
        {"id": "entire-upstream", "scope": "entire_run", "node_id": "upstream"},
        {"id": "entire-target", "scope": "entire_run", "node_id": "target"},
        {"id": "upstream", "scope": "downstream_run", "node_id": "upstream"},
        {"id": "target", "scope": "downstream_run", "node_id": "target"},
    ]


def test_seed_replay_state_seeds_runtime_hitl_memory(monkeypatch):
    from src.flow_engine.grpc_service import _seed_replay_state

    class FakeState:
        def __init__(self, values=None, next_nodes=()):
            self.values = values or {}
            self.next = next_nodes

    captured = {}

    class FakeGraph:
        async def aget_state(self, config):
            tid = config.get("configurable", {}).get("thread_id", "")
            if tid == "exec-src":
                return FakeState(
                    values={
                        "task_outputs": {},
                        "iterations": {"target": 0},
                        "router_decisions": {},
                        "flow_id": "flow-1",
                    },
                )
            return FakeState(values={"execution_id": tid}, next_nodes=("target",))

        async def aupdate_state(self, config, values, as_node=None):
            if as_node == "__input__":
                captured["state_update"] = values
            return config

        async def abulk_update_state(self, config, supersteps):
            return config

        async def astream(self, graph_input, config, **kwargs):
            yield {}

    hitl_memory = [{
        "id": "memory-1",
        "node_id": "target",
        "normalized_instruction": "Use signed documents.",
    }]
    result = asyncio.run(_seed_replay_state(
        FakeGraph(), object(), "exec-new", "exec-src",
        {
            "control_edges": [],
            "nodes": [{"id": "target", "kind": "step"}],
        },
        {"brief": "rerun"},
        "target",
        0,
        hitl_memory,
    ))

    assert result is not None
    assert captured["state_update"]["inputs"] == {"brief": "rerun"}
    assert captured["state_update"]["hitl_memory"] == hitl_memory


def test_seed_replay_checkpoint_clears_stale_hitl_memory(monkeypatch):
    from src.flow_engine.grpc_service import _seed_replay_state

    class FakeState:
        config = {"configurable": {"thread_id": "exec-src", "checkpoint_id": "checkpoint-1"}}
        values = {
            "task_outputs": {},
            "iterations": {"target": 0},
            "router_decisions": {},
            "flow_id": "flow-1",
            "hitl_memory": [{"id": "stale"}],
        }
        next = ("target",)
        parent_config = None

    captured = {}

    async def fake_fork_replay_checkpoint(checkpointer, execution_id, replay_checkpoint_state):
        captured["fork_execution_id"] = execution_id
        return {"configurable": {"thread_id": execution_id, "checkpoint_id": "forked"}}

    class FakeGraph:
        async def aget_state(self, config):
            return FakeState()

        async def aupdate_state(self, config, values, as_node=None):
            captured["state_update"] = values
            captured["as_node"] = as_node
            return config

    monkeypatch.setattr("src.flow_engine.grpc_service._fork_replay_checkpoint", fake_fork_replay_checkpoint)

    result = asyncio.run(_seed_replay_state(
        FakeGraph(), object(), "exec-new", "exec-src",
        {
            "control_edges": [],
            "nodes": [{"id": "target", "kind": "step"}],
        },
        {},
        "target",
        0,
    ))

    assert result is not None
    assert captured["state_update"] == {"hitl_memory": []}
    assert captured["as_node"] == "__input__"


def test_seed_replay_state_does_not_seed_downstream_outputs(monkeypatch):
    from src.flow_engine.grpc_service import _seed_replay_state

    class FakeState:
        def __init__(self, values=None, next_nodes=()):
            self.values = values or {}
            self.next = next_nodes

    captured = {}

    class FakeGraph:
        def __init__(self):
            self.bulk_updates = []

        async def aget_state(self, config):
            tid = config.get("configurable", {}).get("thread_id", "")
            if tid == "exec-src":
                return FakeState(
                    values={
                        "task_outputs": {
                            ("upstream", 0): {"out": "a"},
                            ("target", 0): {"out": "b"},
                            ("downstream", 0): {"out": "c"},
                        },
                        "iterations": {"upstream": 1, "target": 1, "downstream": 1},
                        "router_decisions": {"router-1": "continue"},
                        "flow_id": "flow-1",
                    },
                )
            return FakeState(values={"execution_id": tid}, next_nodes=("target",))

        async def aupdate_state(self, config, values, as_node=None):
            if as_node == "__input__":
                captured["state_update"] = values
            return config

        async def abulk_update_state(self, config, supersteps):
            self.bulk_updates.append(supersteps)
            return config

        async def astream(self, graph_input, config, **kwargs):
            yield {}

    graph = FakeGraph()
    result = asyncio.run(_seed_replay_state(
        graph, object(), "exec-new", "exec-src",
        {
            "control_edges": [
                {"source": "upstream", "target": "target"},
                {"source": "target", "target": "downstream"},
            ],
            "nodes": [
                {"id": "upstream", "kind": "step"},
                {"id": "target", "kind": "step"},
                {"id": "downstream", "kind": "step"},
            ],
        },
        {},
        "target",
        0,
    ))

    assert result is not None
    assert captured["state_update"]["task_outputs"] == {("upstream", 0): {"out": "a"}}
    assert captured["state_update"]["iterations"] == {"upstream": 1, "target": 0}
    assert captured["state_update"]["router_decisions"] == {}
    assert graph.bulk_updates == []


def test_seed_replay_state_bulk_updates_parallel_upstream_frontier(monkeypatch):
    from src.flow_engine.grpc_service import _seed_replay_state

    class FakeState:
        def __init__(self, values=None, next_nodes=()):
            self.values = values or {}
            self.next = next_nodes

    captured = {"bulk_updates": []}

    class FakeGraph:
        async def aget_state(self, config):
            tid = config.get("configurable", {}).get("thread_id", "")
            if tid == "exec-src":
                return FakeState(
                    values={
                        "task_outputs": {
                            ("upstream-a", 0): {"out": "a"},
                            ("upstream-b", 0): {"out": "b"},
                            ("target", 0): {"out": "c"},
                        },
                        "iterations": {"upstream-a": 1, "upstream-b": 1, "target": 1},
                        "router_decisions": {},
                        "flow_id": "flow-1",
                    },
                )
            if not captured["bulk_updates"]:
                return FakeState(values={"execution_id": tid}, next_nodes=("upstream-a", "upstream-b"))
            return FakeState(values={"execution_id": tid}, next_nodes=("target",))

        async def aupdate_state(self, config, values, as_node=None):
            return config

        async def abulk_update_state(self, config, supersteps):
            captured["bulk_updates"].append(supersteps)
            return config

        async def astream(self, graph_input, config, **kwargs):
            yield {}

    result = asyncio.run(_seed_replay_state(
        FakeGraph(), object(), "exec-new", "exec-src",
        {
            "control_edges": [
                {"source": "upstream-a", "target": "target"},
                {"source": "upstream-b", "target": "target"},
            ],
            "nodes": [
                {"id": "upstream-a", "kind": "step"},
                {"id": "upstream-b", "kind": "step"},
                {"id": "target", "kind": "step"},
            ],
        },
        {},
        "target",
        0,
    ))

    assert result is not None
    assert captured["bulk_updates"] == [[
        [
            ({"task_outputs": {("upstream-a", 0): {"out": "a"}}, "iterations": {"upstream-a": 1}}, "upstream-a"),
            ({"task_outputs": {("upstream-b", 0): {"out": "b"}}, "iterations": {"upstream-b": 1}}, "upstream-b"),
        ],
    ]]


def test_run_from_checkpoint_emits_failure_when_seed_fails(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request = pb.RunFromCheckpointRequest(
            execution_id="exec-replay",
            source_execution_id="exec-source",
            flow_id="flow-1",
            target_node_id="step-1",
            target_iteration=0,
        )
        request.snapshot.nodes.add(id="step-1", kind="step")

        async def fake_ensure_checkpointer():
            return object()

        class FakeState:
            values = None
            next = ()

        class FakeGraph:
            async def aget_state(self, config):
                return FakeState()

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", lambda snapshot, checkpointer: FakeGraph())

        events = [event async for event in servicer.RunFromCheckpoint(request, None)]

        assert len(events) == 1
        assert events[0].event_type == "ExecutionFailed"
        assert "step-1" in str(events[0].payload)

    asyncio.run(_run_test())


def test_run_from_checkpoint_streams_from_seeded_config(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer
    from src.flow_engine.runtime.events import _build_event

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request = pb.RunFromCheckpointRequest(
            execution_id="exec-replay",
            source_execution_id="exec-source",
            flow_id="flow-1",
            target_node_id="step-2",
            target_iteration=0,
        )
        request.snapshot.nodes.add(id="step-2", kind="step")

        async def fake_ensure_checkpointer():
            return object()

        class FakeState:
            def __init__(self, values=None, next_nodes=()):
                self.values = values or {}
                self.next = next_nodes

        class FakeGraph:
            async def aget_state(self, config):
                tid = config.get("configurable", {}).get("thread_id", "")
                if tid == "exec-source":
                    return FakeState(
                        values={
                            "task_outputs": {("step-1", 0): {"out": "a"}, ("step-2", 0): {"out": "b"}},
                            "iterations": {"step-1": 1, "step-2": 1},
                            "router_decisions": {},
                            "errors": [],
                            "flow_id": "flow-1",
                        },
                    )
                return FakeState(values={}, next_nodes=("step-1",))

            async def aupdate_state(self, config, values, as_node=None):
                return config

            async def astream(self, graph_input, config, **kwargs):
                yield {}

        captured_config = {}

        async def fake_stream_graph(graph, graph_input, recursion_limit=25, max_parallelism=None, config=None):
            captured_config["graph_input"] = graph_input
            captured_config["config"] = config
            if False:
                yield {}

        async def fake_emit_events(execution_id, event_stream):
            async for _ in event_stream:
                pass
            yield _build_event("NodeStarted", execution_id, "step-2", {}, 0)
            yield _build_event("NodeCompleted", execution_id, "step-2", {"output": "replayed"}, 0)

        async def fake_fork(*args, **kwargs):
            from src.flow_engine.runtime.checkpoint_fork import ForkResult

            return ForkResult(
                config={"configurable": {"thread_id": "exec-replay", "checkpoint_id": "seeded"}},
                source_checkpoint_id="source-checkpoint",
                target_checkpoint_id="seeded",
            )

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", lambda snapshot, checkpointer: FakeGraph())
        monkeypatch.setattr(servicer._checkpoint_forks, "prepare", fake_fork)
        monkeypatch.setattr("src.flow_engine.grpc_service.stream_graph", fake_stream_graph)
        monkeypatch.setattr("src.flow_engine.grpc_service.emit_events", fake_emit_events)

        events = [event async for event in servicer.RunFromCheckpoint(request, None)]

        assert captured_config["graph_input"] is None
        assert events[-1].event_type == "ExecutionCompleted"
        assert len(servicer._active_executions) == 0

    asyncio.run(_run_test())


def test_run_from_checkpoint_resumes_after_approval(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer
    from src.flow_engine.runtime.events import _build_event

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request = pb.RunFromCheckpointRequest(
            execution_id="exec-replay",
            source_execution_id="exec-source",
            flow_id="flow-1",
            target_node_id="step-2",
            target_iteration=0,
        )
        request.snapshot.nodes.add(id="step-2", kind="step")

        async def fake_ensure_checkpointer():
            return object()

        class FakeState:
            def __init__(self, values=None, next_nodes=()):
                self.values = values or {}
                self.next = next_nodes

        class FakeGraph:
            async def aget_state(self, config):
                tid = config.get("configurable", {}).get("thread_id", "")
                if tid == "exec-source":
                    return FakeState(
                        values={
                            "task_outputs": {("step-1", 0): {"out": "a"}, ("step-2", 0): {"out": "b"}},
                            "iterations": {"step-1": 1, "step-2": 1},
                            "router_decisions": {},
                            "errors": [],
                            "flow_id": "flow-1",
                        },
                    )
                return FakeState(values={}, next_nodes=("step-1",))

            async def aupdate_state(self, config, values, as_node=None):
                return config

            async def astream(self, graph_input, config, **kwargs):
                yield {}

        calls = []

        async def fake_stream_graph(graph, graph_input, recursion_limit=25, max_parallelism=None, config=None):
            calls.append(graph_input)
            if False:
                yield {}

        async def fake_emit_events(execution_id, event_stream):
            async for _ in event_stream:
                pass
            if len(calls) == 1:
                yield _build_event("ApprovalRequested", execution_id, "step-2", {"prompt": "approve?"}, 0)
                return
            yield _build_event("ApprovalResolved", execution_id, "step-2", {"decision": "approved"}, 0)
            yield _build_event("NodeCompleted", execution_id, "step-2", {"output": "replayed"}, 0)

        async def fake_fork(*args, **kwargs):
            from src.flow_engine.runtime.checkpoint_fork import ForkResult

            return ForkResult(
                config={"configurable": {"thread_id": "exec-replay", "checkpoint_id": "seeded"}},
                source_checkpoint_id="source-checkpoint",
                target_checkpoint_id="seeded",
            )

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", lambda snapshot, checkpointer: FakeGraph())
        monkeypatch.setattr(servicer._checkpoint_forks, "prepare", fake_fork)
        monkeypatch.setattr("src.flow_engine.grpc_service.stream_graph", fake_stream_graph)
        monkeypatch.setattr("src.flow_engine.grpc_service.emit_events", fake_emit_events)

        async def collect_events():
            events = []
            async for event in servicer.RunFromCheckpoint(request, None):
                events.append(event)
                if event.event_type == "ApprovalRequested":
                    resumed = await servicer.ResumeApproval(
                        pb.ResumeApprovalRequest(
                            execution_id="exec-replay",
                            decision="approved",
                        ),
                        None,
                    )
                    assert resumed.resumed is True
            return events

        events = await collect_events()

        assert calls[0] is None
        assert getattr(calls[1], "resume", None) == {"decision": "approved", "payload": {}}
        assert events[-1].event_type == "ExecutionCompleted"

    asyncio.run(_run_test())


def test_run_reuses_cached_graph_for_same_snapshot(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer
    from src.flow_engine.runtime.graph_cache import CompiledGraphCache

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request_one = pb.RunRequest(execution_id="exec-cache-1", flow_id="flow-cache")
        request_two = pb.RunRequest(execution_id="exec-cache-2", flow_id="flow-cache")
        request_one.snapshot.nodes.add().id = "node-1"
        request_two.snapshot.nodes.add().id = "node-1"
        request_one.input_context.update({"prompt": "first"})
        request_two.input_context.update({"prompt": "second"})

        compose_calls = {"count": 0}
        fake_checkpointer = object()

        async def fake_ensure_checkpointer():
            return fake_checkpointer

        def fake_compose(snapshot, checkpointer):
            compose_calls["count"] += 1
            return {"snapshot": snapshot, "checkpointer": checkpointer}

        async def fake_stream_graph(graph, graph_input, recursion_limit=25, max_parallelism=None, config=None):
            if False:
                yield {}

        async def fake_emit_events(execution_id, event_stream):
            async for _ in event_stream:
                pass
            if False:
                yield None

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", fake_compose)
        monkeypatch.setattr("src.flow_engine.grpc_service.stream_graph", fake_stream_graph)
        monkeypatch.setattr("src.flow_engine.grpc_service.emit_events", fake_emit_events)
        monkeypatch.setattr(
            "src.flow_engine.grpc_service.compiled_graph_cache",
            CompiledGraphCache(max_entries=8, ttl_seconds=900),
        )
        monkeypatch.setattr("src.flow_engine.grpc_service.app_settings.PLAYBOOK_GRAPH_CACHE_ENABLED", True)

        [event async for event in servicer.Run(request_one, None)]
        [event async for event in servicer.Run(request_two, None)]

        assert compose_calls["count"] == 1

    asyncio.run(_run_test())


def test_run_recompiles_when_checkpointer_instance_changes(monkeypatch):
    pytest.importorskip("langgraph", reason="langgraph not installed")
    pb = pytest.importorskip("src.grpc_generated.playbook_flow_pb2", reason="playbook proto not available")
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer
    from src.flow_engine.runtime.graph_cache import CompiledGraphCache

    async def _run_test():
        servicer = PlaybookFlowRuntimeServicer()
        request_one = pb.RunRequest(execution_id="exec-cache-a", flow_id="flow-cache")
        request_two = pb.RunRequest(execution_id="exec-cache-b", flow_id="flow-cache")
        request_one.snapshot.nodes.add().id = "node-1"
        request_two.snapshot.nodes.add().id = "node-1"

        compose_calls = {"count": 0}
        checkpointers = iter([object(), object()])

        async def fake_ensure_checkpointer():
            return next(checkpointers)

        def fake_compose(snapshot, checkpointer):
            compose_calls["count"] += 1
            return {"snapshot": snapshot, "checkpointer": checkpointer}

        async def fake_stream_graph(graph, graph_input, recursion_limit=25, max_parallelism=None, config=None):
            if False:
                yield {}

        async def fake_emit_events(execution_id, event_stream):
            async for _ in event_stream:
                pass
            if False:
                yield None

        monkeypatch.setattr("src.flow_engine.grpc_service.get_checkpointer", lambda: None)
        monkeypatch.setattr("src.flow_engine.grpc_service.ensure_checkpointer", fake_ensure_checkpointer)
        monkeypatch.setattr("src.flow_engine.grpc_service.compose", fake_compose)
        monkeypatch.setattr("src.flow_engine.grpc_service.stream_graph", fake_stream_graph)
        monkeypatch.setattr("src.flow_engine.grpc_service.emit_events", fake_emit_events)
        monkeypatch.setattr(
            "src.flow_engine.grpc_service.compiled_graph_cache",
            CompiledGraphCache(max_entries=8, ttl_seconds=900),
        )
        monkeypatch.setattr("src.flow_engine.grpc_service.app_settings.PLAYBOOK_GRAPH_CACHE_ENABLED", True)

        [event async for event in servicer.Run(request_one, None)]
        [event async for event in servicer.Run(request_two, None)]

        assert compose_calls["count"] == 2

    asyncio.run(_run_test())
