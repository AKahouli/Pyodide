from __future__ import annotations

from collections import defaultdict, deque

from src.flow_engine.dynamic_reasoning.models import (
    DynamicReasoningPolicy,
    GeneratedExecutionPlan,
    ValidationIssue,
)


def validate_plan(
    plan: GeneratedExecutionPlan,
    policy: DynamicReasoningPolicy,
    available_port_ids: set[str],
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    nodes = [*plan.nodes, plan.synthesis]
    ids = [node.id for node in nodes]
    id_set = set(ids)
    nodes_by_id = {node.id: node for node in nodes}
    if len(ids) != len(id_set):
        issues.append(ValidationIssue(code="DUPLICATE_NODE_ID", path="nodes", message="Generated node ids must be unique"))
    if len(plan.nodes) > policy.max_work_nodes:
        issues.append(ValidationIssue(code="WORK_NODE_LIMIT_EXCEEDED", path="nodes", message="Generated plan exceeds the work-node limit", expected=policy.max_work_nodes, actual=len(plan.nodes)))
    if len(plan.nodes) < 2 and not any(node.depends_on for node in plan.nodes):
        issues.append(ValidationIssue(code="INSUFFICIENT_DECOMPOSITION_VALUE", path="nodes", message="Subgraph requires at least two useful work nodes or a validation dependency"))

    adjacency: dict[str, list[str]] = defaultdict(list)
    indegree = {node_id: 0 for node_id in id_set}
    for node in nodes:
        for dependency in node.depends_on:
            if dependency not in id_set:
                issues.append(ValidationIssue(code="UNKNOWN_NODE_REFERENCE", path=f"nodes.{node.id}.dependsOn", message=f"Unknown dependency: {dependency}", related_node_ids=[node.id]))
                continue
            adjacency[dependency].append(node.id)
            indegree[node.id] += 1
        for binding_index, binding in enumerate(node.input_bindings):
            binding_path = f"nodes.{node.id}.inputBindings.{binding_index}"
            if binding.kind.startswith("port") and (not binding.port_id or binding.port_id not in available_port_ids):
                issues.append(ValidationIssue(code="UNKNOWN_INPUT_PORT", path=binding_path, message=f"Unknown parent input port: {binding.port_id}", related_node_ids=[node.id]))
            if binding.kind == "port" and binding.selector != "all":
                issues.append(ValidationIssue(code="INVALID_INPUT_SELECTOR", path=binding_path, message="Port bindings require selector 'all'", related_node_ids=[node.id]))
            if binding.kind == "port-items" and (not binding.item_ids or any(not item_id.strip() for item_id in binding.item_ids)):
                issues.append(ValidationIssue(code="SCHEMA_INVALID", path=f"{binding_path}.itemIds", message="Item bindings require at least one non-empty item id", related_node_ids=[node.id]))
            if binding.kind == "port-partition" and (
                binding.partition_count is None
                or binding.partition_count <= 0
                or binding.partition_index is None
                or binding.partition_index < 0
                or binding.partition_index >= binding.partition_count
            ):
                issues.append(ValidationIssue(code="SCHEMA_INVALID", path=binding_path, message="Partition bindings require a positive count and an in-range index", related_node_ids=[node.id]))
            if binding.kind == "generated-output":
                source_node = nodes_by_id.get(str(binding.node_id)) if binding.node_id else None
                if source_node is None:
                    issues.append(ValidationIssue(code="UNKNOWN_NODE_REFERENCE", path=binding_path, message=f"Unknown generated output node: {binding.node_id}", related_node_ids=[node.id]))
                elif not binding.output_port_id or binding.output_port_id not in {port.id for port in source_node.output_ports}:
                    issues.append(ValidationIssue(code="OUTPUT_SCHEMA_MISMATCH", path=f"{binding_path}.outputPortId", message=f"Unknown generated output port: {binding.output_port_id}", related_node_ids=[node.id, source_node.id]))
                if binding.node_id in id_set and binding.node_id not in node.depends_on:
                    issues.append(ValidationIssue(code="MISSING_DEPENDENCY", path=f"nodes.{node.id}.dependsOn", message=f"Generated output binding requires dependency: {binding.node_id}", related_node_ids=[node.id, str(binding.node_id)]))

    ready = deque(node_id for node_id, degree in indegree.items() if degree == 0)
    visited: list[str] = []
    peak = len(ready)
    while ready:
        current = ready.popleft()
        visited.append(current)
        for target in adjacency[current]:
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
        peak = max(peak, len(ready))
    if len(visited) != len(id_set):
        issues.append(ValidationIssue(code="CYCLIC_DEPENDENCY", path="nodes", message="Generated plan must be acyclic"))
    if peak > policy.max_parallelism:
        issues.append(ValidationIssue(code="PARALLELISM_LIMIT_EXCEEDED", path="nodes", message="Generated plan exceeds the parallelism limit", expected=policy.max_parallelism, actual=peak))

    work_ids = {node.id for node in plan.nodes}
    reachable = set(plan.synthesis.depends_on)
    frontier = list(reachable)
    dependencies = {node.id: set(node.depends_on) for node in plan.nodes}
    while frontier:
        current = frontier.pop()
        for dependency in dependencies.get(current, set()):
            if dependency not in reachable:
                reachable.add(dependency)
                frontier.append(dependency)
    missing = sorted(work_ids - reachable)
    if missing:
        issues.append(ValidationIssue(code="MISSING_SYNTHESIS_PATH", path="synthesis.dependsOn", message="Every work node must feed synthesis", related_node_ids=missing))
    return issues
