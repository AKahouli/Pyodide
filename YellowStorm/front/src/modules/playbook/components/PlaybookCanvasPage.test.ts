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

describe('iterator child task classification', () => {
  it('correctly separates iterator children from top-level tasks', () => {
    const tasks: Array<Pick<PlaybookTask, 'id' | 'containerConfig'>> = [
      { id: 'start', containerConfig: null },
      { id: 'iterator-1', containerConfig: null },
      { id: 'child-1', containerConfig: { parentIteratorId: 'iterator-1' } },
      { id: 'child-2', containerConfig: { parentIteratorId: 'iterator-1' } },
      { id: 'end', containerConfig: null },
    ];

    const iteratorChildren = tasks.filter((t) => t.containerConfig?.parentIteratorId);
    const topLevel = tasks.filter((t) => !t.containerConfig?.parentIteratorId);

    expect(topLevel).toHaveLength(3);
    expect(topLevel.map((t) => t.id)).toEqual(['start', 'iterator-1', 'end']);
    expect(iteratorChildren).toHaveLength(2);
    expect(iteratorChildren.map((t) => t.id)).toEqual(['child-1', 'child-2']);
  });

  it('treats tasks with null or undefined containerConfig as top-level', () => {
    const tasks: Array<Pick<PlaybookTask, 'id' | 'containerConfig'>> = [
      { id: 'task-1', containerConfig: null },
      { id: 'task-2', containerConfig: undefined },
      { id: 'task-3', containerConfig: { parentIteratorId: null } },
    ];

    const topLevel = tasks.filter((t) => !t.containerConfig?.parentIteratorId);

    expect(topLevel).toHaveLength(3);
  });
});
