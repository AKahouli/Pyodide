import { useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { DynamicReasoningAttempt, PlaybookExecution, StepStatus } from '../types';

type RuntimeGraph = {
  focusNodes: Node[];
  focusEdges: Edge[];
  inlineCanvasNodes: Node[];
  inlineNodes: Node[];
  inlineEdges: Edge[];
};

type RuntimeGraphOptions = {
  expandedByContainerId?: Readonly<Record<string, boolean>>;
  onToggleContainer?: (containerId: string, expanded: boolean) => void;
};

type GeneratedPlanNode = NonNullable<DynamicReasoningAttempt['acceptedPlan']>['nodes'][number]
  | NonNullable<DynamicReasoningAttempt['acceptedPlan']>['synthesis'];

const RUNTIME_COLUMN_WIDTH = 320;
const RUNTIME_COLUMN_GAP = 64;
const RUNTIME_ROW_HEIGHT = 180;
const RUNTIME_NODE_WIDTH = 256;
const RUNTIME_NODE_HEIGHT = 108;
const PLAYBOOK_NODE_WIDTH = 384;
const PLAYBOOK_NODE_HEIGHT = 240;
const RUNTIME_CONTAINER_WIDTH = 360;
const RUNTIME_CONTAINER_HEADER_HEIGHT = 64;
const RUNTIME_CONTAINER_PADDING = 24;
const RUNTIME_CONTAINER_VERTICAL_GAP = 64;
const RUNTIME_CHILD_ROW_GAP = 32;
const RUNTIME_PARENT_HANDLE_ID = 'dynamic-reasoning-runtime';
const RUNTIME_CONTAINER_TARGET_HANDLE_ID = 'dynamic-reasoning-container-target';

function runtimeNodeId(attempt: DynamicReasoningAttempt, localNodeId: string) {
  return `${attempt.parentTaskId}::dynamic-reasoning::${attempt.subgraphId}::${localNodeId}`;
}

function runtimeContainerId(execution: PlaybookExecution, attempt: DynamicReasoningAttempt) {
  return `dynamic-reasoning-container:${execution.id}:${attempt.parentTaskId}:${attempt.parentIteration}:${attempt.attempt}`;
}

function latestAttempts(execution: PlaybookExecution | null | undefined) {
  const attempts = new Map<string, DynamicReasoningAttempt>();
  for (const attempt of execution?.dynamicReasoningAttempts ?? []) {
    const previous = attempts.get(attempt.parentTaskId);
    if (!previous
      || attempt.parentIteration > previous.parentIteration
      || (attempt.parentIteration === previous.parentIteration && attempt.attempt >= previous.attempt)) {
      attempts.set(attempt.parentTaskId, attempt);
    }
  }
  return Array.from(attempts.values());
}

function planNodes(attempt: DynamicReasoningAttempt): GeneratedPlanNode[] {
  if (!attempt.acceptedPlan) return [];
  return [...attempt.acceptedPlan.nodes, attempt.acceptedPlan.synthesis];
}

function nodeTitle(node: Node | undefined, fallback: string) {
  const title = (node?.data as { title?: unknown } | undefined)?.title;
  return typeof title === 'string' && title.trim() ? title : fallback;
}

function nodeWidth(node: Node | undefined, fallback = PLAYBOOK_NODE_WIDTH) {
  const measuredWidth = node?.measured?.width;
  if (typeof measuredWidth === 'number' && Number.isFinite(measuredWidth) && measuredWidth > 0) {
    return measuredWidth;
  }
  if (typeof node?.width === 'number' && Number.isFinite(node.width) && node.width > 0) {
    return node.width;
  }
  const styleWidth = node?.style?.width;
  if (typeof styleWidth === 'number' && Number.isFinite(styleWidth) && styleWidth > 0) {
    return styleWidth;
  }
  if (typeof styleWidth === 'string' && /^\d+(?:\.\d+)?px$/.test(styleWidth)) {
    return Number.parseFloat(styleWidth);
  }
  return fallback;
}

function nodeHeight(node: Node | undefined, fallback = PLAYBOOK_NODE_HEIGHT) {
  const measuredHeight = node?.measured?.height;
  if (typeof measuredHeight === 'number' && Number.isFinite(measuredHeight) && measuredHeight > 0) {
    return measuredHeight;
  }
  if (typeof node?.height === 'number' && Number.isFinite(node.height) && node.height > 0) {
    return node.height;
  }
  const styleHeight = node?.style?.height;
  if (typeof styleHeight === 'number' && Number.isFinite(styleHeight) && styleHeight > 0) {
    return styleHeight;
  }
  if (typeof styleHeight === 'string' && /^\d+(?:\.\d+)?px$/.test(styleHeight)) {
    return Number.parseFloat(styleHeight);
  }
  return fallback;
}

function attemptStepStatus(attempt: DynamicReasoningAttempt): StepStatus {
  if (attempt.status === 'planning') return 'pending';
  if (attempt.status === 'direct') return 'skipped';
  return attempt.status;
}

function absoluteNodePosition(node: Node, nodesById: Map<string, Node>) {
  let position = { ...node.position };
  let parentId = node.parentId;
  const visited = new Set([node.id]);

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (!parent) break;
    position = { x: position.x + parent.position.x, y: position.y + parent.position.y };
    parentId = parent.parentId;
  }

  return position;
}

function downstreamNodeIds(parentId: string, edges: Edge[], validNodeIds: Set<string>) {
  const targetsBySource = new Map<string, string[]>();
  for (const edge of edges) {
    if (!validNodeIds.has(edge.source) || !validNodeIds.has(edge.target)) continue;
    const targets = targetsBySource.get(edge.source) ?? [];
    targets.push(edge.target);
    targetsBySource.set(edge.source, targets);
  }

  const downstream = new Set<string>();
  const queue = [...(targetsBySource.get(parentId) ?? [])];
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (downstream.has(nodeId) || nodeId === parentId) continue;
    downstream.add(nodeId);
    queue.push(...(targetsBySource.get(nodeId) ?? []));
  }
  return downstream;
}

function ancestorNodeIds(node: Node, nodesById: Map<string, Node>) {
  const ancestors = new Set<string>();
  let parentId = node.parentId;
  while (parentId && !ancestors.has(parentId)) {
    ancestors.add(parentId);
    parentId = nodesById.get(parentId)?.parentId;
  }
  return ancestors;
}

function shiftNodesVertically(nodes: Node[], nodeIds: Set<string>, delta: number) {
  if (delta <= 0 || nodeIds.size === 0) return nodes;

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const absolutePositions = new Map(nodes.map((node) => [node.id, absoluteNodePosition(node, nodesById)]));

  return nodes.map((node) => {
    if (!nodeIds.has(node.id)) return node;
    const parentAbsolutePosition = node.parentId ? absolutePositions.get(node.parentId) : undefined;
    const parentShift = node.parentId && nodeIds.has(node.parentId) ? delta : 0;
    const absolutePosition = absolutePositions.get(node.id)!;
    return {
      ...node,
      position: {
        x: node.position.x,
        y: absolutePosition.y + delta - ((parentAbsolutePosition?.y ?? 0) + parentShift),
      },
    };
  });
}

function containerDimensions(attempt: DynamicReasoningAttempt, expanded: boolean) {
  const generated = planNodes(attempt);
  if (!expanded || generated.length === 0) {
    return {
      width: RUNTIME_CONTAINER_WIDTH,
      height: expanded ? RUNTIME_CONTAINER_HEADER_HEIGHT + 56 : RUNTIME_CONTAINER_HEADER_HEIGHT,
    };
  }

  const byId = new Map(generated.map((node) => [node.id, node]));
  const rowsByDepth = new Map<number, number>();
  let maxDepth = 0;
  for (const generatedNode of generated) {
    const depth = dependencyDepth(generatedNode, byId);
    maxDepth = Math.max(maxDepth, depth);
    rowsByDepth.set(depth, (rowsByDepth.get(depth) ?? 0) + 1);
  }
  const maxRows = Math.max(...rowsByDepth.values());
  return {
    width: Math.max(
      RUNTIME_CONTAINER_WIDTH,
      RUNTIME_CONTAINER_PADDING * 2 + RUNTIME_NODE_WIDTH + maxDepth * RUNTIME_COLUMN_WIDTH,
    ),
    height: RUNTIME_CONTAINER_HEADER_HEIGHT
      + RUNTIME_CONTAINER_PADDING * 2
      + maxRows * RUNTIME_NODE_HEIGHT
      + Math.max(0, maxRows - 1) * RUNTIME_CHILD_ROW_GAP,
  };
}

function buildInlineContainerGraph(
  execution: PlaybookExecution,
  attempt: DynamicReasoningAttempt,
  parent: Node,
  containerPosition: { x: number; y: number },
  expanded: boolean,
  options: RuntimeGraphOptions,
) {
  const containerId = runtimeContainerId(execution, attempt);
  const generated = planNodes(attempt);
  const byId = new Map(generated.map((node) => [node.id, node]));
  const results = new Map(execution.taskResults.map((result) => [result.taskId, result]));
  const rowsByDepth = new Map<number, number>();
  const dimensions = containerDimensions(attempt, expanded);
  const nodes: Node[] = [{
    id: containerId,
    type: 'dynamicReasoningRuntimeContainer',
    position: containerPosition,
    width: dimensions.width,
    height: dimensions.height,
    style: { width: dimensions.width, height: dimensions.height },
    draggable: false,
    connectable: false,
    deletable: false,
    selectable: false,
    zIndex: 0,
    data: {
      title: nodeTitle(parent, attempt.parentTaskId),
      status: attemptStepStatus(attempt),
      generatedCount: generated.length,
      expanded,
      planning: !attempt.acceptedPlan,
      onToggle: () => options.onToggleContainer?.(containerId, !expanded),
    },
  }];
  const edges: Edge[] = [{
    id: `runtime-inline:${parent.id}:${containerId}`,
    source: parent.id,
    target: containerId,
    sourceHandle: RUNTIME_PARENT_HANDLE_ID,
    targetHandle: RUNTIME_CONTAINER_TARGET_HANDLE_ID,
    type: 'smoothstep',
    selectable: false,
    deletable: false,
    ariaLabel: `${nodeTitle(parent, attempt.parentTaskId)} Dynamic Reasoning`,
    data: { runtime: true },
  }];

  if (!expanded || !attempt.acceptedPlan || !attempt.subgraphId) {
    return { nodes, edges, dimensions };
  }

  for (const generatedNode of generated) {
    const depth = dependencyDepth(generatedNode, byId);
    const row = rowsByDepth.get(depth) ?? 0;
    rowsByDepth.set(depth, row + 1);
    const runtimeId = runtimeNodeId(attempt, generatedNode.id);
    const result = results.get(runtimeId);
    nodes.push({
      id: runtimeId,
      type: 'playbookRuntimeStep',
      parentId: containerId,
      extent: 'parent',
      position: {
        x: RUNTIME_CONTAINER_PADDING + RUNTIME_COLUMN_WIDTH * depth,
        y: RUNTIME_CONTAINER_HEADER_HEIGHT
          + RUNTIME_CONTAINER_PADDING
          + (RUNTIME_NODE_HEIGHT + RUNTIME_CHILD_ROW_GAP) * row,
      },
      measured: { width: RUNTIME_NODE_WIDTH, height: RUNTIME_NODE_HEIGHT },
      draggable: false,
      connectable: false,
      deletable: false,
      zIndex: 1,
      data: {
        title: generatedNode.title,
        status: result?.status ?? 'pending',
        synthesis: generatedNode.kind === 'synthesis',
      },
    });

    for (const dependency of generatedNode.dependsOn) {
      if (!byId.has(dependency)) continue;
      edges.push({
        id: `runtime-inline:${dependency}:${runtimeId}`,
        source: runtimeNodeId(attempt, dependency),
        target: runtimeId,
        type: 'smoothstep',
        animated: result?.status === 'running',
        selectable: false,
        deletable: false,
        ariaLabel: `${byId.get(dependency)?.title ?? dependency} to ${generatedNode.title}`,
        data: { runtime: true },
      });
    }
  }

  return { nodes, edges, dimensions };
}

function rectanglesOverlap(left: Node, right: Node, nodesById: Map<string, Node>) {
  const leftPosition = absoluteNodePosition(left, nodesById);
  const rightPosition = absoluteNodePosition(right, nodesById);
  return leftPosition.x < rightPosition.x + nodeWidth(right)
    && leftPosition.x + nodeWidth(left) > rightPosition.x
    && leftPosition.y < rightPosition.y + nodeHeight(right)
    && leftPosition.y + nodeHeight(left) > rightPosition.y;
}

function orderAttempts(
  attempts: DynamicReasoningAttempt[],
  downstreamByParent: Map<string, Set<string>>,
  nodesById: Map<string, Node>,
) {
  const stableCompare = (left: DynamicReasoningAttempt, right: DynamicReasoningAttempt) => {
    const leftNode = nodesById.get(left.parentTaskId);
    const rightNode = nodesById.get(right.parentTaskId);
    const leftPosition = leftNode ? absoluteNodePosition(leftNode, nodesById) : { x: 0, y: 0 };
    const rightPosition = rightNode ? absoluteNodePosition(rightNode, nodesById) : { x: 0, y: 0 };
    return leftPosition.x - rightPosition.x
      || leftPosition.y - rightPosition.y
      || left.parentTaskId.localeCompare(right.parentTaskId);
  };
  const remaining = new Map(attempts.map((attempt) => [attempt.parentTaskId, attempt]));
  const ordered: DynamicReasoningAttempt[] = [];

  while (remaining.size) {
    const candidates = Array.from(remaining.values()).filter((candidate) => (
      Array.from(remaining.keys()).every((parentId) => (
        parentId === candidate.parentTaskId
        || !downstreamByParent.get(parentId)?.has(candidate.parentTaskId)
      ))
    ));
    const next = (candidates.length ? candidates : Array.from(remaining.values()))
      .sort(stableCompare)[0];
    ordered.push(next);
    remaining.delete(next.parentTaskId);
  }

  return ordered;
}

function dependencyDepth(node: GeneratedPlanNode, byId: Map<string, GeneratedPlanNode>, seen = new Set<string>()): number {
  if (!node.dependsOn.length || seen.has(node.id)) return 0;
  seen.add(node.id);
  return 1 + Math.max(...node.dependsOn.map((dependency) => {
    const parent = byId.get(dependency);
    return parent ? dependencyDepth(parent, byId, new Set(seen)) : 0;
  }));
}

function buildGeneratedGraph(
  execution: PlaybookExecution,
  attempt: DynamicReasoningAttempt,
  parentId: string,
  parentTitle: string,
  parentPosition: { x: number; y: number },
  parentWidth: number,
  edgePrefix: string,
  parentSourceHandle?: string,
): { nodes: Node[]; edges: Edge[] } {
  const generated = planNodes(attempt);
  const byId = new Map(generated.map((node) => [node.id, node]));
  const results = new Map(execution.taskResults.map((result) => [result.taskId, result]));
  const rowsByDepth = new Map<number, number>();
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const generatedNode of generated) {
    const depth = dependencyDepth(generatedNode, byId);
    const row = rowsByDepth.get(depth) ?? 0;
    rowsByDepth.set(depth, row + 1);
    const runtimeId = runtimeNodeId(attempt, generatedNode.id);
    const result = results.get(runtimeId);
    nodes.push({
      id: runtimeId,
      type: 'playbookRuntimeStep',
      position: {
        x: parentPosition.x + parentWidth + RUNTIME_COLUMN_GAP + RUNTIME_COLUMN_WIDTH * depth,
        y: parentPosition.y + RUNTIME_ROW_HEIGHT * row,
      },
      measured: { width: RUNTIME_NODE_WIDTH, height: RUNTIME_NODE_HEIGHT },
      draggable: false,
      connectable: false,
      deletable: false,
      data: {
        title: generatedNode.title,
        status: result?.status ?? 'pending',
        synthesis: generatedNode.kind === 'synthesis',
      },
    });

    const dependencies = generatedNode.dependsOn.length ? generatedNode.dependsOn : [parentId];
    for (const dependency of dependencies) {
      const sourceTitle = dependency === parentId
        ? parentTitle
        : byId.get(dependency)?.title ?? dependency;
      edges.push({
        id: `${edgePrefix}:${dependency}:${runtimeId}`,
        source: dependency === parentId ? parentId : runtimeNodeId(attempt, dependency),
        target: runtimeId,
        sourceHandle: dependency === parentId ? parentSourceHandle : undefined,
        type: 'smoothstep',
        animated: result?.status === 'running',
        selectable: false,
        deletable: false,
        ariaLabel: `${sourceTitle} to ${generatedNode.title}`,
        data: { runtime: true },
      });
    }
  }

  return { nodes, edges };
}

export function buildExecutionRuntimeGraph(
  execution: PlaybookExecution | null | undefined,
  canvasNodes: Node[],
  canvasEdges: Edge[] = [],
  options: RuntimeGraphOptions = {},
): RuntimeGraph {
  if (!execution) {
    return { focusNodes: [], focusEdges: [], inlineCanvasNodes: canvasNodes, inlineNodes: [], inlineEdges: [] };
  }

  const focusNodes: Node[] = [];
  const focusEdges: Edge[] = [];
  const inlineNodes: Node[] = [];
  const inlineEdges: Edge[] = [];
  let inlineCanvasNodes = canvasNodes;
  const validNodeIds = new Set(canvasNodes.map((node) => node.id));
  const attempts = latestAttempts(execution).filter((attempt) => attempt.status !== 'direct');
  const initialNodesById = new Map(canvasNodes.map((node) => [node.id, node]));
  const downstreamByParent = new Map(attempts.map((attempt) => [
    attempt.parentTaskId,
    downstreamNodeIds(attempt.parentTaskId, canvasEdges, validNodeIds),
  ]));
  const projectedRuntimeParentIds = new Set<string>();
  const projectedRuntimeAnchorIds = new Set<string>();
  const placedContainers: Node[] = [];

  for (const attempt of orderAttempts(attempts, downstreamByParent, initialNodesById)) {
    const canvasNodesById = new Map(inlineCanvasNodes.map((node) => [node.id, node]));
    const parent = canvasNodesById.get(attempt.parentTaskId);
    const parentTitle = nodeTitle(parent, attempt.parentTaskId);
    const focusParentId = `runtime-parent:${attempt.parentTaskId}`;
    const focusParentPosition = { x: 0, y: focusNodes.length * RUNTIME_ROW_HEIGHT };
    focusNodes.push({
      id: focusParentId,
      type: 'playbookRuntimeStep',
      position: focusParentPosition,
      measured: { width: RUNTIME_NODE_WIDTH, height: RUNTIME_NODE_HEIGHT },
      draggable: false,
      connectable: false,
      deletable: false,
      data: {
        title: parentTitle,
        status: attemptStepStatus(attempt),
        planning: !attempt.acceptedPlan,
      },
    });

    if (attempt.acceptedPlan && attempt.subgraphId) {
      const focusGraph = buildGeneratedGraph(
        execution,
        attempt,
        focusParentId,
        parentTitle,
        focusParentPosition,
        RUNTIME_NODE_WIDTH,
        'runtime-focus',
      );
      focusNodes.push(...focusGraph.nodes);
      focusEdges.push(...focusGraph.edges);

    }

    if (parent) {
      const containerId = runtimeContainerId(execution, attempt);
      const expanded = options.expandedByContainerId?.[containerId]
        ?? (attempt.status === 'planning' || attempt.status === 'running');
      const parentPosition = absoluteNodePosition(parent, canvasNodesById);
      const dimensions = containerDimensions(attempt, expanded);
      const parentAncestorIds = ancestorNodeIds(parent, canvasNodesById);
      let anchorBottom = parentPosition.y + nodeHeight(parent);
      for (const ancestorId of parentAncestorIds) {
        const ancestor = canvasNodesById.get(ancestorId);
        if (!ancestor) continue;
        const position = absoluteNodePosition(ancestor, canvasNodesById);
        anchorBottom = Math.max(anchorBottom, position.y + nodeHeight(ancestor));
      }
      const containerPosition = {
        x: parentPosition.x + nodeWidth(parent) / 2 - dimensions.width / 2,
        y: anchorBottom + RUNTIME_CONTAINER_VERTICAL_GAP,
      };
      let overlapsContainer = true;
      while (overlapsContainer) {
        overlapsContainer = false;
        const candidate: Node = {
          id: containerId,
          position: containerPosition,
          width: dimensions.width,
          height: dimensions.height,
          data: {},
        };
        for (const placed of placedContainers) {
          const placedMap = new Map([[placed.id, placed], [candidate.id, candidate]]);
          if (!rectanglesOverlap(candidate, placed, placedMap)) continue;
          containerPosition.y = placed.position.y + nodeHeight(placed, dimensions.height) + RUNTIME_CONTAINER_VERTICAL_GAP;
          overlapsContainer = true;
        }
      }

      const inlineGraph = buildInlineContainerGraph(
        execution,
        attempt,
        parent,
        containerPosition,
        expanded,
        options,
      );
      inlineNodes.push(...inlineGraph.nodes);
      inlineEdges.push(...inlineGraph.edges);
      placedContainers.push(inlineGraph.nodes[0]);

      const immutableRuntimeAnchorIds = new Set([...projectedRuntimeAnchorIds, parent.id, ...parentAncestorIds]);
      const affectedNodeIds = new Set<string>();
      const containerNode = inlineGraph.nodes[0];
      for (const staticNode of inlineCanvasNodes) {
        if (immutableRuntimeAnchorIds.has(staticNode.id)) continue;
        if (!rectanglesOverlap(containerNode, staticNode, canvasNodesById)) continue;
        affectedNodeIds.add(staticNode.id);
        for (const downstreamId of downstreamNodeIds(staticNode.id, canvasEdges, validNodeIds)) {
          if (!immutableRuntimeAnchorIds.has(downstreamId)) affectedNodeIds.add(downstreamId);
        }
      }

      const affectedTop = Math.min(...Array.from(affectedNodeIds, (nodeId) => {
        const node = canvasNodesById.get(nodeId);
        return node ? absoluteNodePosition(node, canvasNodesById).y : Number.POSITIVE_INFINITY;
      }));
      if (Number.isFinite(affectedTop)) {
        inlineCanvasNodes = shiftNodesVertically(
          inlineCanvasNodes,
          affectedNodeIds,
          Math.max(
            0,
            containerPosition.y + inlineGraph.dimensions.height + RUNTIME_CONTAINER_VERTICAL_GAP - affectedTop,
          ),
        );
      }

      projectedRuntimeParentIds.add(parent.id);
      projectedRuntimeAnchorIds.add(parent.id);
      for (const ancestorId of parentAncestorIds) projectedRuntimeAnchorIds.add(ancestorId);
    }
  }

  if (inlineNodes.length) {
    inlineCanvasNodes = inlineCanvasNodes.map((node) => ({
      ...node,
      connectable: false,
      deletable: false,
      data: projectedRuntimeParentIds.has(node.id)
        ? { ...node.data, dynamicReasoningRuntimeSourceHandleId: RUNTIME_PARENT_HANDLE_ID }
        : node.data,
    }));
  }

  return { focusNodes, focusEdges, inlineCanvasNodes, inlineNodes, inlineEdges };
}

export function useExecutionFocusGraph(
  execution: PlaybookExecution | null | undefined,
  canvasNodes: Node[],
  canvasEdges: Edge[],
  options: RuntimeGraphOptions = {},
) {
  return useMemo(
    () => buildExecutionRuntimeGraph(execution, canvasNodes, canvasEdges, options),
    [execution, canvasEdges, canvasNodes, options],
  );
}
