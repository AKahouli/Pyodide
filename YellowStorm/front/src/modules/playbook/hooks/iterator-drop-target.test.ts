import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { findDropTargetIterator } from './usePlaybookCanvas';

describe('iterator drop targets', () => {
  const loop: Node = { id: 'loop', type: 'playbookIteratorContainer', position: { x: 0, y: 0 }, width: 800, height: 500, data: {} };
  const task: Node = { id: 'task', position: { x: 400, y: 200 }, width: 240, height: 100, data: {} };

  it('does not reparent a drop into collapsed or hidden loop bounds', () => {
    const point = { x: 500, y: 250 };
    expect(findDropTargetIterator([loop], task, point)).toBe('loop');
    expect(findDropTargetIterator([{ ...loop, data: { iteratorCollapsed: true } }], task, point)).toBeNull();
    expect(findDropTargetIterator([{ ...loop, hidden: true }], task, point)).toBeNull();
  });
});
