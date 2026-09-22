import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { foldIteratorGraph } from './fold-iterator-graph';

const nodes: Node[] = [
  { id: 'loop', type: 'playbookIteratorContainer', position: { x: 20, y: 30 }, data: {}, width: 800, height: 500 },
  { id: 'child', parentId: 'loop', position: { x: 40, y: 60 }, data: {} },
  { id: 'nested', parentId: 'child', position: { x: 10, y: 10 }, data: {} },
  { id: 'after', position: { x: 1000, y: 30 }, data: {} },
];

describe('foldIteratorGraph', () => {
  it('hides descendants and internal edges without changing saved geometry', () => {
    const edges = [{ id: 'internal', source: 'child', target: 'nested' }, { id: 'out', source: 'loop', target: 'after' }];
    const folded = foldIteratorGraph(nodes, edges, new Set(['loop']));
    expect(folded.nodes[0].width).toBe(320);
    expect(folded.nodes[1].hidden).toBe(true);
    expect(folded.nodes[2].hidden).toBe(true);
    expect(folded.edges[0].hidden).toBe(true);
    expect(folded.edges[1].hidden).toBe(false);
    expect(nodes[0].width).toBe(800);
    expect(foldIteratorGraph(nodes, edges, new Set()).nodes[0].height).toBe(500);
  });

  it('does not fold a loop with child routes crossing its boundary', () => {
    const folded = foldIteratorGraph(nodes, [{ id: 'bypass', source: 'child', target: 'after' }], new Set(['loop']));
    expect(folded.collapsed.size).toBe(0);
    expect(folded.nodes[1].hidden).toBe(false);
  });
});
