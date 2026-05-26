import asyncio

import pytest
from google.protobuf.json_format import ParseDict

from src.flow_engine.grpc_contract import (
    snapshot_to_dict,
    should_emit_fallback_completion,
    struct_to_dict,
    unwrap_metadata_fields,
    value_to_python,
)

struct_pb2 = pytest.importorskip("google.protobuf.struct_pb2", reason="protobuf not available")


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
