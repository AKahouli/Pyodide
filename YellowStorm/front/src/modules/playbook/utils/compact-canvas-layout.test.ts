import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { layoutCompactCanvasNodes } from './compact-canvas-layout';

function node(id: string): Node {
  return { id, type: 'x', position: { x: 0, y: 0 }, data: {} };
}

describe('layoutCompactCanvasNodes', () => {
  it('positions every node and returns the same edges back', () => {
    const nodes = [node('a'), node('b')];
    const edges: Edge[] = [{ id: 'a->b', source: 'a', target: 'b' }];

    const result = layoutCompactCanvasNodes(nodes, edges);

    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(result.edges).toHaveLength(1);
  });

  it('attaches dagre-routed waypoints to an edge spanning more than one rank, so the renderer can draw the actual routed path instead of a straight line that may pass behind an unrelated same-rank node', () => {
    // a -> b -> c, plus a -> d directly: d has no intermediate dependency on
    // b/c, but dagre ranks it alongside c (2 ranks from a) -- exactly the
    // shape that produced session 9d416a1757da4ab2af7dbe108bc31bc1's "Check
    // Ethereum market" -> "Write execution memo" edge visually passing
    // behind "Ask oussama".
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges: Edge[] = [
      { id: 'a->b', source: 'a', target: 'b' },
      { id: 'b->c', source: 'b', target: 'c' },
      { id: 'a->d', source: 'a', target: 'd' },
    ];

    const result = layoutCompactCanvasNodes(nodes, edges);

    const longEdge = result.edges.find((e) => e.id === 'a->d');
    const points = (longEdge?.data as { dagrePoints?: { x: number; y: number }[] } | undefined)?.dagrePoints;
    expect(points).toBeDefined();
    expect(points!.length).toBeGreaterThanOrEqual(2);
  });

  it('returns nodes and edges unchanged when there are no nodes', () => {
    expect(layoutCompactCanvasNodes([], [])).toEqual({ nodes: [], edges: [] });
  });
});
