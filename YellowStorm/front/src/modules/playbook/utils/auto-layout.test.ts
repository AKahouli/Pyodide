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
});
