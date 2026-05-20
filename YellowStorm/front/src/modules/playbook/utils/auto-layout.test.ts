import { describe, expect, it } from 'vitest';
import { autoLayoutTasks } from './auto-layout';
import { makeEdge, makeTask } from '../test-utils';

describe('autoLayoutTasks', () => {
  it('returns same reference for empty task list', () => {
    const tasks: ReturnType<typeof makeTask>[] = [];
    const result = autoLayoutTasks(tasks, []);
    expect(result).toBe(tasks);
  });

  it('returns positioned tasks without mutating originals', () => {
    const tasks = [
      makeTask({ id: 'a', positionX: 0, positionY: 0 }),
      makeTask({ id: 'b', positionX: 0, positionY: 0, executionOrder: 2 }),
    ];
    const edges = [makeEdge({ id: 'e1', sourceId: 'a', targetId: 'b' })];

    const result = autoLayoutTasks(tasks, edges);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
    expect(result[0].positionX).not.toBeNaN();
    expect(result[0].positionY).not.toBeNaN();
    expect(tasks[0].positionX).toBe(0);
    expect(tasks[0].positionY).toBe(0);
  });

  it('preserves iterator child relative positions while moving them with the parent iterator', () => {
    const tasks = [
      makeTask({ id: 'iterator-1', taskType: 'iterator', nodeType: 'iterator', positionX: 40, positionY: 80 }),
      makeTask({ id: 'child-1', executionOrder: 1, positionX: 72, positionY: 168, containerConfig: { parentIteratorId: 'iterator-1' } }),
      makeTask({ id: 'child-2', executionOrder: 2, positionX: 520, positionY: 168, containerConfig: { parentIteratorId: 'iterator-1' } }),
      makeTask({ id: 'child-3', executionOrder: 3, positionX: 72, positionY: 456, containerConfig: { parentIteratorId: 'iterator-1' } }),
      makeTask({ id: 'outside', positionX: 500, positionY: 120 }),
    ];
    const edges = [makeEdge({ id: 'e1', sourceId: 'iterator-1', targetId: 'outside' })];

    const result = autoLayoutTasks(tasks, edges);

    const iterator = result.find((task) => task.id === 'iterator-1');
    const child1 = result.find((task) => task.id === 'child-1');
    const child2 = result.find((task) => task.id === 'child-2');
    const child3 = result.find((task) => task.id === 'child-3');

    expect(iterator).toBeTruthy();
    expect(child1).toBeTruthy();
    expect(child2).toBeTruthy();
    expect(child3).toBeTruthy();

    expect(child1!.positionX - iterator!.positionX).toBe(32);
    expect(child1!.positionY - iterator!.positionY).toBe(88);
    expect(child2!.positionX - iterator!.positionX).toBe(480);
    expect(child2!.positionY - iterator!.positionY).toBe(88);
    expect(child3!.positionX - iterator!.positionX).toBe(32);
    expect(child3!.positionY - iterator!.positionY).toBe(376);
  });

  it('uses iterator container dimensions when spacing top-level nodes', () => {
    const tasks = [
      makeTask({ id: 'iterator-1', taskType: 'iterator', nodeType: 'iterator', positionX: 0, positionY: 0, iteratorLayout: { width: 900, height: 500 } }),
      makeTask({ id: 'after', positionX: 100, positionY: 0 }),
    ];
    const edges = [makeEdge({ id: 'e1', sourceId: 'iterator-1', targetId: 'after' })];

    const result = autoLayoutTasks(tasks, edges);
    const iterator = result.find((task) => task.id === 'iterator-1');
    const after = result.find((task) => task.id === 'after');

    expect(iterator).toBeTruthy();
    expect(after).toBeTruthy();
    expect(after!.positionX).toBeGreaterThanOrEqual(iterator!.positionX + 900 - 384 / 2);
  });

  it('adds more separation between simple connected nodes', () => {
    const tasks = [
      makeTask({ id: 'a', positionX: 0, positionY: 0 }),
      makeTask({ id: 'b', positionX: 0, positionY: 0, executionOrder: 2 }),
    ];
    const edges = [makeEdge({ id: 'e1', sourceId: 'a', targetId: 'b' })];

    const result = autoLayoutTasks(tasks, edges);
    const first = result.find((task) => task.id === 'a');
    const second = result.find((task) => task.id === 'b');

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second!.positionX - first!.positionX).toBeGreaterThanOrEqual(640);
  });

  it('keeps branch siblings from overlapping vertically after auto-layout', () => {
    const tasks = [
      makeTask({ id: 'root', positionX: 0, positionY: 0 }),
      makeTask({ id: 'branch-a', positionX: 0, positionY: 0, executionOrder: 2 }),
      makeTask({ id: 'branch-b', positionX: 0, positionY: 0, executionOrder: 3 }),
    ];
    const edges = [
      makeEdge({ id: 'e1', sourceId: 'root', targetId: 'branch-a' }),
      makeEdge({ id: 'e2', sourceId: 'root', targetId: 'branch-b' }),
    ];

    const result = autoLayoutTasks(tasks, edges);
    const branchA = result.find((task) => task.id === 'branch-a');
    const branchB = result.find((task) => task.id === 'branch-b');

    expect(branchA).toBeTruthy();
    expect(branchB).toBeTruthy();
    expect(Math.abs(branchB!.positionY - branchA!.positionY)).toBeGreaterThanOrEqual(560);
  });

  it('layouts two connected iterators as separate top-level nodes', () => {
    const tasks = [
      makeTask({ id: 'iter-1', taskType: 'iterator', nodeType: 'iterator', positionX: 0, positionY: 0 }),
      makeTask({ id: 'iter-2', taskType: 'iterator', nodeType: 'iterator', positionX: 0, positionY: 0 }),
    ];
    const edges = [makeEdge({ id: 'e1', sourceId: 'iter-1', targetId: 'iter-2' })];

    const result = autoLayoutTasks(tasks, edges);

    expect(result).toHaveLength(2);
    const iter1 = result.find((t) => t.id === 'iter-1');
    const iter2 = result.find((t) => t.id === 'iter-2');
    expect(iter1).toBeTruthy();
    expect(iter2).toBeTruthy();
    expect(iter1!.positionX).not.toBeNaN();
    expect(iter2!.positionX).not.toBeNaN();
  });
});
