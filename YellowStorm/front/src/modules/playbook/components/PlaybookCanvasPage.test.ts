import { describe, expect, it } from 'vitest';
import { buildCanvasStepStatusMap } from './PlaybookCanvasPage';
import type { PlaybookExecution, PlaybookTask } from '../types';

describe('buildCanvasStepStatusMap', () => {
  it('projects iterator child statuses from nested iterator iterations only', () => {
    const tasks = [
      { id: 'normal-task', containerConfig: null },
      { id: 'iterator-1', containerConfig: null },
      { id: 'iterator-child', containerConfig: { parentIteratorId: 'iterator-1' } },
    ] satisfies Pick<PlaybookTask, 'id' | 'containerConfig'>[];

    const taskResults = [
      { taskId: 'normal-task', status: 'running' },
      {
        taskId: 'iterator-1',
        status: 'running',
        iteratorIterations: [
          {
            index: 0,
            status: 'running',
            childResults: [
              { taskId: 'iterator-child', taskTitle: 'Child', status: 'running' },
            ],
          },
        ],
      },
      { taskId: 'iterator-child', status: 'completed' },
    ] as PlaybookExecution['taskResults'];

    const statusMap = buildCanvasStepStatusMap(taskResults, tasks);

    expect(statusMap.get('normal-task')).toBe('running');
    expect(statusMap.get('iterator-1')).toBe('running');
    expect(statusMap.get('iterator-child')).toBe('running');
  });

  it('falls back to the direct child task status when nested iterator data is missing', () => {
    const tasks = [
      { id: 'iterator-1', containerConfig: null },
      { id: 'iterator-child', containerConfig: { parentIteratorId: 'iterator-1' } },
    ] satisfies Pick<PlaybookTask, 'id' | 'containerConfig'>[];

    const taskResults = [
      {
        taskId: 'iterator-1',
        status: 'completed',
        iteratorIterations: [],
      },
      { taskId: 'iterator-child', status: 'completed' },
    ] as PlaybookExecution['taskResults'];

    const statusMap = buildCanvasStepStatusMap(taskResults, tasks);

    expect(statusMap.get('iterator-child')).toBe('completed');
  });
});
