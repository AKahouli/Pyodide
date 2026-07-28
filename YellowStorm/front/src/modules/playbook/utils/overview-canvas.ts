import { MarkerType, Position, type Edge, type Node, type XYPosition } from '@xyflow/react';
import type { ELK, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';

import type { PlaybookNodeData, PlaybookNodeType, StepStatus } from '../types';
import { getEffectiveNodeType } from './node-type';

export const OVERVIEW_NODE_WIDTH = 220;
export const OVERVIEW_NODE_HEIGHT = 96;

export type OverviewNodeKind = PlaybookNodeType | 'trigger';

export interface OverviewNodeData extends Record<string, unknown> {
  title: string;
  kind: OverviewNodeKind;
  executionOrder?: number;
  assignedAgentId?: string | null;
  stepStatus?: StepStatus;
  childCount?: number;
  isConfigured?: boolean;
  isEnabled?: boolean;
  canExecute?: boolean;
  executionDisabled?: boolean;
  onExecute?: (nodeId: string) => void;
  dimmed?: boolean;
}

export interface OverviewEdgeData extends Record<string, unknown> {
  kind: 'sequential' | 'conditional';
  routerLabel?: string | null;
  mergedCount: number;
  routePoints?: XYPosition[];
  dimmed?: boolean;
}

export type OverviewNode = Node<OverviewNodeData, 'playbookOverview'>;
export type OverviewEdge = Edge<OverviewEdgeData, 'overviewControl'>;

export interface OverviewGraph {
  nodes: OverviewNode[];
  edges: OverviewEdge[];
}

function getOverviewKind(node: Node): OverviewNodeKind {
  if (node.id === '__trigger__' || node.type === 'playbookTrigger') return 'trigger';
  return getEffectiveNodeType(node.data as unknown as PlaybookNodeData);
}

function isOverviewTaskConfigured(data: PlaybookNodeData, kind: OverviewNodeKind): boolean {
  if (kind === 'trigger') return false;
  if (kind === 'evaluation') {
    return Boolean(data.assignedAgentId && (data.evaluationConfig?.expectation || data.evaluationConfig?.referenceBaselineId));
  }
  if (kind === 'action' || data.executionMode === 'action') return Boolean(data.selectedAction);
  if (kind === 'agent') return Boolean(data.assignedAgentId);
  return false;
}

function resolveVisibleNodeId(nodeId: string, nodeMap: Map<string, Node>): string {
  let current = nodeMap.get(nodeId);
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    current = nodeMap.get(current.parentId) ?? current;
  }
  return current?.id ?? nodeId;
}

export function projectOverviewGraph(sourceNodes: Node[], sourceEdges: Edge[]): OverviewGraph {
  const nodeMap = new Map(sourceNodes.map((node) => [node.id, node]));
  const childCounts = new Map<string, number>();
  for (const node of sourceNodes) {
    if (node.parentId) childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
  }

  const visibleSourceNodes = sourceNodes.filter((node) => !node.parentId);
  const nodes = visibleSourceNodes
    .slice()
    .sort((left, right) => {
      const leftOrder = Number((left.data as { executionOrder?: number }).executionOrder ?? -1);
      const rightOrder = Number((right.data as { executionOrder?: number }).executionOrder ?? -1);
      return leftOrder - rightOrder;
    })
    .map((node, index): OverviewNode => {
      const data = node.data as unknown as PlaybookNodeData & { title?: string };
      const kind = getOverviewKind(node);
      return {
        id: node.id,
        type: 'playbookOverview',
        position: { x: index * 300, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        selectable: true,
        draggable: false,
        connectable: false,
        data: {
          title: data.title || (kind === 'trigger' ? 'Trigger' : ''),
          kind,
          executionOrder: kind === 'trigger' ? undefined : data.executionOrder,
          assignedAgentId: data.assignedAgentId,
          stepStatus: data.stepStatus as StepStatus | undefined,
          childCount: childCounts.get(node.id),
          isConfigured: isOverviewTaskConfigured(data, kind),
          isEnabled: data.enabled !== false,
        },
        style: { width: OVERVIEW_NODE_WIDTH, height: OVERVIEW_NODE_HEIGHT },
      };
    });

  const visibleIds = new Set(nodes.map((node) => node.id));
  const mergedEdges = new Map<string, OverviewEdge>();
  for (const edge of sourceEdges) {
    const source = resolveVisibleNodeId(edge.source, nodeMap);
    const target = resolveVisibleNodeId(edge.target, nodeMap);
    if (source === target || !visibleIds.has(source) || !visibleIds.has(target)) continue;

    const sourceData = (edge.data ?? {}) as Record<string, unknown>;
    const kind = edge.type === 'conditional' || sourceData.kind === 'conditional'
      ? 'conditional'
      : 'sequential';
    const routerLabel = kind === 'conditional'
      ? String(sourceData.routerLabel ?? edge.sourceHandle ?? '') || null
      : null;
    const key = `${source}\u0000${target}\u0000${kind}\u0000${routerLabel ?? ''}`;
    const existing = mergedEdges.get(key);
    if (existing) {
      existing.data = { ...existing.data!, mergedCount: existing.data!.mergedCount + 1 };
      continue;
    }

    mergedEdges.set(key, {
      id: `overview:${mergedEdges.size}:${source}->${target}`,
      source,
      target,
      type: 'overviewControl',
      selectable: false,
      focusable: false,
      deletable: false,
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      data: { kind, routerLabel, mergedCount: 1 },
    });
  }

  return { nodes, edges: [...mergedEdges.values()] };
}

function toElkGraph(graph: OverviewGraph): ElkNode {
  return {
    id: 'overview-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.spacing.nodeNode': '56',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.layered.spacing.edgeNodeBetweenLayers': '36',
      'elk.layered.mergeEdges': 'false',
      'elk.padding': '[top=36,left=36,bottom=36,right=36]',
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: OVERVIEW_NODE_WIDTH,
      height: OVERVIEW_NODE_HEIGHT,
    })),
    edges: graph.edges.map((edge): ElkExtendedEdge => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}

function getRoutePoints(edge: ElkExtendedEdge): XYPosition[] | undefined {
  const section = edge.sections?.[0];
  if (!section) return undefined;
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
}

export async function layoutOverviewGraph(graph: OverviewGraph, elk: ELK): Promise<OverviewGraph> {
  if (graph.nodes.length === 0) return graph;
  const result = await elk.layout(toElkGraph(graph));
  const positions = new Map((result.children ?? []).map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
  const routes = new Map((result.edges ?? []).map((edge) => [edge.id, getRoutePoints(edge)]));
  return {
    nodes: graph.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      data: { ...edge.data!, routePoints: routes.get(edge.id) },
    })),
  };
}

export function getOverviewFocusIds(edges: OverviewEdge[], selectedNodeId: string | null): Set<string> | null {
  if (!selectedNodeId) return null;
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const focused = new Set([selectedNodeId]);
  const visit = (start: string, adjacency: Map<string, string[]>) => {
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      for (const next of adjacency.get(current) ?? []) {
        if (focused.has(next)) continue;
        focused.add(next);
        queue.push(next);
      }
    }
  };
  visit(selectedNodeId, incoming);
  visit(selectedNodeId, outgoing);
  return focused;
}
