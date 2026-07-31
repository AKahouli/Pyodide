import type { Edge, Node } from '@xyflow/react';
import type { ELK, ElkNode } from 'elkjs/lib/elk-api';
import { describe, expect, it, vi } from 'vitest';

import {
  getOverviewFocusIds,
  layoutOverviewGraph,
  projectOverviewGraph,
} from './overview-canvas';

function taskNode(id: string, executionOrder: number, nodeType: string, parentId?: string): Node {
  return {
    id,
    type: nodeType === 'iterator' ? 'playbookIteratorContainer' : 'playbookStep',
    parentId,
    position: { x: executionOrder * 100, y: 0 },
    data: {
      id,
      title: id,
      executionOrder,
      nodeType,
      taskType: nodeType,
      executionMode: 'agent',
    },
  };
}

function controlEdge(id: string, source: string, target: string, routerLabel?: string): Edge {
  return {
    id,
    source,
    target,
    type: routerLabel ? 'conditional' : 'animated',
    data: routerLabel ? { kind: 'conditional', routerLabel } : { kind: 'sequential' },
  };
}

describe('overview canvas projection', () => {
  it('collapses iterator children and merges only equivalent semantic edges', () => {
    const nodes = [
      taskNode('iterator', 0, 'iterator'),
      taskNode('child', 1, 'agent', 'iterator'),
      taskNode('router', 2, 'router'),
      taskNode('approved', 3, 'agent'),
    ];
    const edges = [
      controlEdge('internal', 'iterator', 'child'),
      controlEdge('child-router', 'child', 'router'),
      controlEdge('duplicate', 'iterator', 'router'),
      controlEdge('yes-1', 'router', 'approved', 'yes'),
      controlEdge('yes-2', 'router', 'approved', 'yes'),
      controlEdge('no', 'router', 'approved', 'no'),
    ];

    const graph = projectOverviewGraph(nodes, edges);

    expect(graph.nodes.map((node) => node.id)).toEqual(['iterator', 'router', 'approved']);
    expect(graph.nodes[0]!.data.childCount).toBe(1);
    expect(graph.nodes[0]!.data.isConfigured).toBe(false);
    expect(graph.nodes[2]!.data).toMatchObject({ isConfigured: false, isEnabled: true });
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges.find((edge) => edge.source === 'iterator')?.data?.mergedCount).toBe(2);
    expect(graph.edges.filter((edge) => edge.source === 'router').map((edge) => edge.data!.routerLabel)).toEqual(['yes', 'no']);
    expect(edges).toHaveLength(6);
  });

  it('finds upstream and downstream paths without looping on cycles', () => {
    const graph = projectOverviewGraph(
      [taskNode('a', 0, 'agent'), taskNode('b', 1, 'router'), taskNode('c', 2, 'agent'), taskNode('unrelated', 3, 'agent')],
      [controlEdge('ab', 'a', 'b'), controlEdge('bc', 'b', 'c'), controlEdge('cb', 'c', 'b')],
    );

    expect([...getOverviewFocusIds(graph.edges, 'b')!].sort()).toEqual(['a', 'b', 'c']);
    expect(getOverviewFocusIds(graph.edges, null)).toBeNull();
  });

  it('applies ELK positions and orthogonal route points without mutating the projection', async () => {
    const graph = projectOverviewGraph(
      [taskNode('a', 0, 'agent'), taskNode('b', 1, 'agent')],
      [controlEdge('ab', 'a', 'b')],
    );
    const layout = vi.fn(async (input: ElkNode) => ({
      ...input,
      children: input.children?.map((node, index) => ({ ...node, x: index * 300 + 10, y: 40 })),
      edges: input.edges?.map((edge) => ({
        ...edge,
        sections: [{
          id: `${edge.id}-section`,
          startPoint: { x: 230, y: 82 },
          bendPoints: [{ x: 270, y: 82 }],
          endPoint: { x: 310, y: 82 },
        }],
      })),
    }));

    const result = await layoutOverviewGraph(graph, { layout } as unknown as ELK);

    expect(result.nodes.map((node) => node.position)).toEqual([{ x: 10, y: 40 }, { x: 310, y: 40 }]);
    expect(result.edges[0]!.data!.routePoints).toEqual([
      { x: 230, y: 82 },
      { x: 270, y: 82 },
      { x: 310, y: 82 },
    ]);
    expect(graph.nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });
});
