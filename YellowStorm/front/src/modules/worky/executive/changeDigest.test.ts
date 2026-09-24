import { describe, expect, it } from 'vitest';
import type { WorkyTask } from '../types';
import { changedTasks, snapshotTasks } from './changeDigest';

const task = (id: string, lane: WorkyTask['lane'], updatedAt: string | null) => ({ id, lane, updatedAt }) as WorkyTask;

describe('local task change digest', () => {
  it('reports new tasks, lane changes and updates since the acknowledged snapshot', () => {
    const before = snapshotTasks([task('a', 'ready', '2026-09-23'), task('b', 'running', '2026-09-23')]);
    const after = [task('a', 'done', '2026-09-24'), task('b', 'running', '2026-09-23'), task('c', 'ready', '2026-09-24')];
    expect(changedTasks(after, before).map((item) => item.id)).toEqual(['a', 'c']);
  });
});
