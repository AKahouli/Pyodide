import pytest
import asyncio
import json
from types import SimpleNamespace
from google.protobuf.json_format import MessageToDict

from src.flow_engine.dynamic_reasoning.ids import runtime_node_id
from src.flow_engine.dynamic_reasoning.models import (
    DynamicReasoningPolicy,
    GeneratedExecutionPlan,
    GeneratedInputBinding,
    GeneratedOutputPort,
    DynamicReasoningDecision,
    PlannerSnapshot,
)
from src.flow_engine.dynamic_reasoning.validator import validate_plan
from src.flow_engine.dynamic_reasoning.input_context import build_input_context_envelope
from src.flow_engine.dynamic_reasoning.executor import _execute_plan, resolve_generated_inputs, run_dynamic_reasoning
from src.flow_engine.dynamic_reasoning.planner import PlannerDecisionError, decide
from src.flow_engine.runtime.events import emit_events


def valid_plan() -> GeneratedExecutionPlan:
    return GeneratedExecutionPlan.model_validate({
        "schemaVersion": "1",
        "nodes": [
            {"id": "research", "title": "Research", "instruction": "Research evidence", "inputBindings": [{"kind": "port", "portId": "input", "selector": "all"}], "outputPorts": [], "dependsOn": []},
            {"id": "verify", "title": "Verify", "instruction": "Verify evidence", "inputBindings": [], "outputPorts": [], "dependsOn": ["research"]},
        ],
        "synthesis": {"id": "synthesis", "kind": "synthesis", "title": "Synthesize", "instruction": "Return the final answer", "inputBindings": [], "outputPorts": [], "dependsOn": ["verify"]},
    })


def planner_snapshot() -> PlannerSnapshot:
    return PlannerSnapshot(
        agentId="planner-1",
        agentTypeSlug="playbook_planner",
        model="planner-model",
    )


def planner_response(content: str) -> SimpleNamespace:
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


@pytest.mark.asyncio
async def test_dynamic_event_grpc_boundary_unwraps_payload() -> None:
    async def stream():
        yield {
            "_mode": "custom",
            "_data": {
                "type": "DynamicReasoningDecided",
                "node_id": "step-1",
                "iteration": 2,
                "payload": {"mode": "direct", "directSafe": True},
            },
        }

    events = [event async for event in emit_events("exec-1", stream())]

    assert len(events) == 1
    assert events[0].node_id == "step-1"
    assert events[0].iteration == 2
    assert MessageToDict(events[0].payload) == {"mode": "direct", "directSafe": True}


@pytest.mark.asyncio
async def test_planner_supplies_decision_schema_and_accepts_complete_direct_response(monkeypatch) -> None:
    captured: dict = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return planner_response(json.dumps({
            "mode": "direct",
            "reasonCodes": ["ATOMIC_TASK"],
            "reasonSummary": "The task is atomic.",
            "confidence": 0.95,
            "consideredFactors": [],
            "directSafe": True,
            "plan": None,
        }))

    monkeypatch.setattr("src.flow_engine.dynamic_reasoning.planner.litellm.acompletion", fake_completion)

    decision = await decide(planner_snapshot(), {"nodeId": "step-1"}, {"ports": []})

    assert decision.mode == "direct"
    assert captured["response_format"] == {"type": "json_object"}
    assert '"reasonSummary"' in captured["messages"][0]["content"]
    assert '"directSafe"' in captured["messages"][0]["content"]


@pytest.mark.asyncio
async def test_planner_rejects_shorthand_direct_response_without_leaking_content(monkeypatch) -> None:
    raw_content = json.dumps({"nodeId": "private-node", "decision": "DIRECT"})

    async def fake_completion(**_kwargs):
        return planner_response(raw_content)

    monkeypatch.setattr("src.flow_engine.dynamic_reasoning.planner.litellm.acompletion", fake_completion)

    with pytest.raises(PlannerDecisionError, match="invalid decision") as exc_info:
        await decide(planner_snapshot(), {"nodeId": "step-1"}, {"ports": []})

    assert "private-node" not in str(exc_info.value)


@pytest.mark.asyncio
async def test_planner_rejects_subgraph_decision_without_plan(monkeypatch) -> None:
    async def fake_completion(**_kwargs):
        return planner_response(json.dumps({
            "mode": "subgraph",
            "reasonCodes": [],
            "reasonSummary": "Decomposition would help.",
            "confidence": 0.8,
            "consideredFactors": [],
            "directSafe": False,
            "plan": None,
        }))

    monkeypatch.setattr("src.flow_engine.dynamic_reasoning.planner.litellm.acompletion", fake_completion)

    with pytest.raises(PlannerDecisionError, match="invalid decision"):
        await decide(planner_snapshot(), {"nodeId": "step-1"}, {"ports": []})


@pytest.mark.asyncio
async def test_planner_validation_failure_emits_terminal_event(monkeypatch) -> None:
    async def invalid_decision(*_args, **_kwargs):
        raise PlannerDecisionError("raw private planner output")

    child_called = False

    async def execute_child(*_args, **_kwargs):
        nonlocal child_called
        child_called = True
        return {}

    events: list[dict] = []
    monkeypatch.setattr("src.flow_engine.dynamic_reasoning.executor.decide", invalid_decision)

    with pytest.raises(ValueError, match="invalid decision") as exc_info:
        await run_dynamic_reasoning(
            node_id="step-1",
            node_config={"id": "step-1", "label": "Step"},
            resolved_inputs={},
            policy=DynamicReasoningPolicy(),
            planner=planner_snapshot(),
            iteration=0,
            writer=events.append,
            child_executor=execute_child,
        )

    assert [event["type"] for event in events] == ["DynamicPlanningStarted", "DynamicPlanningFailed"]
    assert events[-1]["payload"]["error"] == "Playbook Planner returned an invalid decision"
    assert "raw private planner output" not in str(exc_info.value)
    assert child_called is False


@pytest.mark.asyncio
async def test_invalid_repair_decision_emits_terminal_event(monkeypatch) -> None:
    plan = valid_plan()
    plan.nodes[0].input_bindings[0].port_id = "missing"
    initial = DynamicReasoningDecision(
        mode="subgraph",
        reasonSummary="Decomposition would help.",
        confidence=0.9,
        directSafe=False,
        plan=plan,
    )

    async def initial_decision(*_args, **_kwargs):
        return initial

    async def invalid_repair(*_args, **_kwargs):
        raise PlannerDecisionError("raw invalid repair")

    child_called = False

    async def execute_child(*_args, **_kwargs):
        nonlocal child_called
        child_called = True
        return {}

    events: list[dict] = []
    monkeypatch.setattr("src.flow_engine.dynamic_reasoning.executor.decide", initial_decision)
    monkeypatch.setattr("src.flow_engine.dynamic_reasoning.executor.repair_plan", invalid_repair)

    with pytest.raises(ValueError, match="invalid decision"):
        await run_dynamic_reasoning(
            node_id="step-1",
            node_config={"id": "step-1", "label": "Step"},
            resolved_inputs={},
            policy=DynamicReasoningPolicy(),
            planner=planner_snapshot(),
            iteration=0,
            writer=events.append,
            child_executor=execute_child,
        )

    assert events[-1]["type"] == "DynamicPlanningFailed"
    assert events[-1]["payload"]["error"] == "Playbook Planner returned an invalid decision"
    assert child_called is False


@pytest.mark.asyncio
async def test_repaired_direct_decision_is_emitted_with_fallback(monkeypatch) -> None:
    plan = valid_plan()
    plan.nodes[0].input_bindings[0].port_id = "missing"
    initial = DynamicReasoningDecision(
        mode="subgraph",
        reasonSummary="Decomposition would help.",
        confidence=0.8,
        directSafe=False,
        plan=plan,
    )
    repaired = DynamicReasoningDecision(
        mode="direct",
        reasonSummary="The task is safer to execute directly.",
        confidence=0.95,
        directSafe=True,
    )

    async def initial_decision(*_args, **_kwargs):
        return initial

    async def direct_repair(*_args, **_kwargs):
        return repaired

    child_called = False

    async def execute_child(*_args, **_kwargs):
        nonlocal child_called
        child_called = True
        return {}

    events: list[dict] = []
    monkeypatch.setattr("src.flow_engine.dynamic_reasoning.executor.decide", initial_decision)
    monkeypatch.setattr("src.flow_engine.dynamic_reasoning.executor.repair_plan", direct_repair)

    outcome = await run_dynamic_reasoning(
        node_id="step-1",
        node_config={"id": "step-1", "label": "Step"},
        resolved_inputs={},
        policy=DynamicReasoningPolicy(),
        planner=planner_snapshot(),
        iteration=0,
        writer=events.append,
        child_executor=execute_child,
    )

    assert outcome.mode == "direct"
    assert outcome.decision == repaired
    assert events[-1]["type"] == "DynamicDirectFallback"
    assert events[-1]["payload"]["decision"]["mode"] == "direct"
    assert events[-1]["payload"]["decision"]["reasonSummary"] == repaired.reason_summary
    assert child_called is False


def test_validates_complete_generated_dag() -> None:
    assert validate_plan(valid_plan(), DynamicReasoningPolicy(), {"input"}) == []


def test_aggregates_graph_and_binding_issues() -> None:
    plan = valid_plan()
    plan.nodes[0].input_bindings[0].port_id = "missing"
    plan.nodes[1].depends_on = ["unknown"]
    issues = validate_plan(plan, DynamicReasoningPolicy(max_work_nodes=1), {"input"})
    codes = {issue.code for issue in issues}
    assert {"WORK_NODE_LIMIT_EXCEEDED", "UNKNOWN_INPUT_PORT", "UNKNOWN_NODE_REFERENCE", "MISSING_SYNTHESIS_PATH"}.issubset(codes)


@pytest.mark.parametrize("binding", [
    {"kind": "port-items", "portId": "input", "itemIds": []},
    {"kind": "port-items", "portId": "input", "itemIds": [""]},
    {"kind": "port-partition", "portId": "input", "partitionIndex": 0, "partitionCount": 0},
    {"kind": "port-partition", "portId": "input", "partitionIndex": 2, "partitionCount": 2},
])
def test_rejects_malformed_parent_port_bindings(binding: dict) -> None:
    plan = valid_plan()
    plan.nodes[0].input_bindings = [GeneratedInputBinding.model_validate(binding)]

    assert "SCHEMA_INVALID" in {issue.code for issue in validate_plan(plan, DynamicReasoningPolicy(), {"input"})}


def test_rejects_unknown_generated_output_port() -> None:
    plan = valid_plan()
    plan.nodes[0].output_ports = [GeneratedOutputPort(id="summary")]
    plan.nodes[1].input_bindings = [GeneratedInputBinding.model_validate({
        "kind": "generated-output",
        "nodeId": "research",
        "outputPortId": "missing",
    })]

    assert "OUTPUT_SCHEMA_MISMATCH" in {issue.code for issue in validate_plan(plan, DynamicReasoningPolicy(), {"input"})}


def test_runtime_ids_are_namespaced_and_validate_local_ids() -> None:
    assert runtime_node_id("parent", "abc", "work-1") == "parent::dynamic-reasoning::abc::work-1"
    with pytest.raises(ValueError):
        runtime_node_id("parent", "abc", "INVALID")


def test_planner_envelope_never_contains_raw_input_values() -> None:
    envelope = build_input_context_envelope(
        {"input": {"ports": [{"id": "secret", "type": "text", "required": True}]}},
        {"secret": "customer-secret-value"},
    )
    assert "customer-secret-value" not in str(envelope)
    assert envelope["ports"][0]["samples"] == []
    assert envelope["ports"][0]["valueFingerprint"].startswith("sha256:")


def test_resolves_only_accepted_input_bindings() -> None:
    plan = GeneratedExecutionPlan.model_validate({
        "schemaVersion": "1",
        "nodes": [{
            "id": "partition", "title": "Partition", "instruction": "Process partition",
            "inputBindings": [{"kind": "port-partition", "portId": "items", "partitionIndex": 1, "partitionCount": 2}],
            "outputPorts": [], "dependsOn": [],
        }, {
            "id": "selected", "title": "Selected", "instruction": "Process selected",
            "inputBindings": [{"kind": "port-items", "portId": "items", "itemIds": ["b"]}],
            "outputPorts": [], "dependsOn": [],
        }],
        "synthesis": {"id": "synthesis", "kind": "synthesis", "title": "Synthesize", "instruction": "Synthesize", "inputBindings": [], "outputPorts": [], "dependsOn": ["partition", "selected"]},
    })
    parent = {"items": [{"id": "a"}, {"id": "b"}, {"id": "c"}], "unboundSecret": "must-not-flow"}
    assert resolve_generated_inputs(plan.nodes[0], parent, {}) == {"items": [{"id": "b"}]}
    assert resolve_generated_inputs(plan.nodes[1], parent, {}) == {"items": [{"id": "b"}]}


def test_rejects_missing_generated_output_at_runtime() -> None:
    plan = valid_plan()
    plan.nodes[0].output_ports = [GeneratedOutputPort(id="summary")]
    plan.nodes[1].input_bindings = [GeneratedInputBinding.model_validate({
        "kind": "generated-output",
        "nodeId": "research",
        "outputPortId": "summary",
    })]

    with pytest.raises(ValueError, match="Generated output port is unavailable"):
        resolve_generated_inputs(plan.nodes[1], {}, {"research": {"outputs": {}}})


@pytest.mark.asyncio
async def test_cancellation_propagates_to_parallel_children() -> None:
    plan = valid_plan()
    plan.nodes[1].depends_on = []
    started = asyncio.Event()
    cancelled = 0

    async def execute_child(*_args):
        nonlocal cancelled
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled += 1
            raise

    task = asyncio.create_task(_execute_plan(plan, "parent", "graph", {"input": "value"}, 2, execute_child))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled == 2


@pytest.mark.asyncio
async def test_generated_output_flows_to_dependent_node() -> None:
    plan = valid_plan()
    plan.nodes[0].output_ports = [GeneratedOutputPort(id="summary")]
    plan.nodes[1].input_bindings = [GeneratedInputBinding.model_validate({
        "kind": "generated-output",
        "nodeId": "research",
        "outputPortId": "summary",
    })]
    received_inputs: dict[str, dict] = {}

    async def execute_child(runtime_id, _title, _instruction, child_inputs):
        local_id = str(child_inputs["generatedLocalNodeId"])
        received_inputs[local_id] = child_inputs
        if local_id == "research":
            assert child_inputs["generatedOutputPorts"] == [{"id": "summary", "type": "text"}]
            return {"outputs": {"summary": {"content": "verified facts"}}}
        return {"output": "complete"}

    _, result = await _execute_plan(plan, "parent", "graph", {"input": "topic"}, 2, execute_child)

    assert received_inputs["verify"]["inputs"] == {
        "generated:research": {"content": "verified facts"},
    }
    assert result == {"output": "complete"}
