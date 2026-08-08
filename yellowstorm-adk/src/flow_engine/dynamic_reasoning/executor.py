from __future__ import annotations

import asyncio
import uuid
from typing import Any, Awaitable, Callable

from src.flow_engine.dynamic_reasoning.events import emit_dynamic_event
from src.flow_engine.dynamic_reasoning.ids import runtime_node_id
from src.flow_engine.dynamic_reasoning.input_context import build_input_context_envelope
from src.flow_engine.dynamic_reasoning.models import (
    DynamicReasoningOutcome,
    DynamicReasoningPolicy,
    GeneratedExecutionPlan,
    PlannerSnapshot,
)
from src.flow_engine.dynamic_reasoning.planner import PlannerDecisionError, decide
from src.flow_engine.dynamic_reasoning.repair import repair_plan
from src.flow_engine.dynamic_reasoning.validator import validate_plan

ChildExecutor = Callable[[str, str, str, dict[str, Any]], Awaitable[dict[str, Any]]]


def _planner_failure_message(exc: Exception) -> str:
    if isinstance(exc, PlannerDecisionError):
        return "Playbook Planner returned an invalid decision"
    return "Playbook Planner request failed"


def resolve_generated_inputs(node: Any, parent_inputs: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    resolved: dict[str, Any] = {}
    for binding in node.input_bindings:
        if binding.kind == "port":
            resolved[str(binding.port_id)] = parent_inputs.get(str(binding.port_id))
        elif binding.kind == "port-items":
            value = parent_inputs.get(str(binding.port_id))
            if not isinstance(value, list):
                raise ValueError(f"Port {binding.port_id} is not a list")
            requested = set(binding.item_ids)
            resolved[str(binding.port_id)] = [
                item for item in value
                if isinstance(item, dict) and str(item.get("id")) in requested
            ]
        elif binding.kind == "port-partition":
            value = parent_inputs.get(str(binding.port_id))
            if not isinstance(value, list) or not binding.partition_count or binding.partition_index is None:
                raise ValueError(f"Invalid partition binding for port {binding.port_id}")
            if binding.partition_index < 0 or binding.partition_index >= binding.partition_count:
                raise ValueError(f"Partition index is out of range for port {binding.port_id}")
            resolved[str(binding.port_id)] = value[binding.partition_index::binding.partition_count]
        elif binding.kind == "generated-output":
            source = outputs.get(str(binding.node_id))
            if source is None:
                raise ValueError(f"Generated output is unavailable: {binding.node_id}")
            source_outputs = source.get("outputs") if isinstance(source, dict) else None
            if not binding.output_port_id or not isinstance(source_outputs, dict) or binding.output_port_id not in source_outputs:
                raise ValueError(f"Generated output port is unavailable: {binding.node_id}.{binding.output_port_id}")
            source = source_outputs[binding.output_port_id]
            resolved[f"generated:{binding.node_id}"] = source
    return resolved


async def _execute_plan(
    plan: GeneratedExecutionPlan,
    parent_node_id: str,
    subgraph_id: str,
    input_context: dict[str, Any],
    max_parallelism: int,
    child_executor: ChildExecutor,
) -> tuple[str, dict[str, Any]]:
    pending = {node.id: node for node in [*plan.nodes, plan.synthesis]}
    outputs: dict[str, Any] = {}
    semaphore = asyncio.Semaphore(max_parallelism)

    async def run_node(local_id: str) -> None:
        node = pending[local_id]
        async with semaphore:
            runtime_id = runtime_node_id(parent_node_id, subgraph_id, local_id)
            bound_inputs = resolve_generated_inputs(node, input_context, outputs)
            outputs[local_id] = await child_executor(runtime_id, node.title, node.instruction, {
                "inputs": bound_inputs,
                "runtimeSubgraphId": subgraph_id,
                "parentNodeId": parent_node_id,
                "generatedLocalNodeId": local_id,
                "generatedKind": node.kind,
                "generatedOutputPorts": [port.model_dump(by_alias=True) for port in node.output_ports],
            })

    while pending:
        ready = sorted(node.id for node in pending.values() if all(dependency in outputs for dependency in node.depends_on))
        if not ready:
            raise ValueError("Generated plan cannot make progress")
        await asyncio.gather(*(run_node(node_id) for node_id in ready))
        for node_id in ready:
            pending.pop(node_id)
    return subgraph_id, outputs[plan.synthesis.id]


async def run_dynamic_reasoning(
    node_id: str,
    node_config: dict[str, Any],
    resolved_inputs: dict[str, Any],
    policy: DynamicReasoningPolicy,
    planner: PlannerSnapshot,
    iteration: int,
    writer: Any,
    child_executor: ChildExecutor,
) -> DynamicReasoningOutcome:
    envelope = build_input_context_envelope(node_config, resolved_inputs)
    descriptor = {
        "nodeId": node_id,
        "title": str(node_config.get("label") or node_id),
        "task": str(node_config.get("description") or (node_config.get("metadata") or {}).get("description") or ""),
        "expectedOutput": (node_config.get("metadata") or {}).get("expectedResult"),
        "availableCapabilityIds": [],
    }
    emit_dynamic_event(writer, "DynamicPlanningStarted", node_id, iteration, {"inputContext": envelope})
    try:
        decision = await decide(planner, descriptor, envelope)
    except Exception as exc:
        message = _planner_failure_message(exc)
        emit_dynamic_event(writer, "DynamicPlanningFailed", node_id, iteration, {"error": message})
        raise ValueError(message) from exc
    emit_dynamic_event(writer, "DynamicReasoningDecided", node_id, iteration, decision.model_dump(exclude={"plan"}, by_alias=True))
    if decision.mode == "direct":
        return DynamicReasoningOutcome(mode="direct", decision=decision)

    current = decision
    issues = validate_plan(current.plan, policy, set(resolved_inputs))
    emit_dynamic_event(writer, "DynamicPlanProposed", node_id, iteration, {"revision": 0, "plan": current.plan.model_dump(by_alias=True)})
    revision = 0
    while issues and revision < policy.max_repair_attempts:
        emit_dynamic_event(writer, "DynamicPlanValidationFailed", node_id, iteration, {"revision": revision, "validationIssues": [issue.model_dump(by_alias=True) for issue in issues]})
        emit_dynamic_event(writer, "DynamicPlanRepairStarted", node_id, iteration, {"revision": revision + 1})
        try:
            current = await repair_plan(planner, descriptor, envelope, current, issues)
        except Exception as exc:
            message = _planner_failure_message(exc)
            emit_dynamic_event(writer, "DynamicPlanningFailed", node_id, iteration, {"error": message})
            raise ValueError(message) from exc
        revision += 1
        if current.mode == "direct":
            emit_dynamic_event(writer, "DynamicDirectFallback", node_id, iteration, {
                "decision": current.model_dump(exclude={"plan"}, by_alias=True),
                "validationIssues": [issue.model_dump(by_alias=True) for issue in issues],
            })
            return DynamicReasoningOutcome(mode="direct", decision=current, validation_issues=issues)
        if current.plan is None:
            break
        emit_dynamic_event(writer, "DynamicPlanRepaired", node_id, iteration, {"revision": revision, "plan": current.plan.model_dump(by_alias=True)})
        issues = validate_plan(current.plan, policy, set(resolved_inputs))

    if current.plan is None or issues:
        if current.direct_safe:
            emit_dynamic_event(writer, "DynamicDirectFallback", node_id, iteration, {
                "decision": current.model_dump(exclude={"plan"}, by_alias=True),
                "validationIssues": [issue.model_dump(by_alias=True) for issue in issues],
            })
            return DynamicReasoningOutcome(mode="direct", decision=current, validation_issues=issues)
        emit_dynamic_event(writer, "DynamicPlanningFailed", node_id, iteration, {"validationIssues": [issue.model_dump(by_alias=True) for issue in issues]})
        raise ValueError("Playbook Planner produced no valid subgraph and direct execution is unsafe")

    subgraph_id = uuid.uuid4().hex[:16]
    emit_dynamic_event(writer, "RuntimeSubgraphCreated", node_id, iteration, {"subgraphId": subgraph_id, "acceptedRevision": revision, "plan": current.plan.model_dump(by_alias=True)})
    try:
        subgraph_id, result_payload = await _execute_plan(current.plan, node_id, subgraph_id, resolved_inputs, policy.max_parallelism, child_executor)
    except Exception as exc:
        emit_dynamic_event(writer, "RuntimeSubgraphFailed", node_id, iteration, {"error": str(exc)})
        raise
    emit_dynamic_event(writer, "RuntimeSubgraphCompleted", node_id, iteration, {"subgraphId": subgraph_id})
    return DynamicReasoningOutcome(mode="subgraph", decision=decision, result_payload=result_payload, accepted_plan=current.plan, validation_issues=issues)
