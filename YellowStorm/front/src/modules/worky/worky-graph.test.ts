import { describe, expect, it } from 'vitest';
import { buildWorkyGraph } from './worky-graph';
import type { WorkyTask } from './types';

function task(overrides: Partial<WorkyTask>): WorkyTask {
  return {
    id: overrides.id ?? 'task-1',
    streamId: 'stream-1',
    externalId: null,
    title: 'Task',
    description: '',
    lane: 'ready',
    planningStatus: 'confirmed',
    executionState: 'not_started',
    priority: 'medium',
    assigneeType: 'unassigned',
    assigneeId: null,
    actionCategory: 'internal_analysis',
    dependsOn: [],
    wave: null,
    dependsOnStepIds: [],
    blockerReason: null,
    result: null,
    blockedReason: null,
    theoreticalDeadlineAt: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    ...overrides,
  };
}

describe('buildWorkyGraph', () => {
  it('draws an edge from the upstream task to the dependent one, matched by externalId', () => {
    const upstream = task({ id: 'a', externalId: 'step-1', title: 'Send the email' });
    const downstream = task({ id: 'b', externalId: 'step-2', dependsOnStepIds: ['step-1'] });
    const { edges } = buildWorkyGraph([upstream, downstream]);
    expect(edges).toEqual([
      { id: 'a->b', source: 'a', target: 'b', type: 'workyDependency', markerEnd: expect.anything() },
    ]);
  });

  it('produces one node per task, keyed by the Mongo id', () => {
    const { nodes } = buildWorkyGraph([task({ id: 'a' }), task({ id: 'b' })]);
    expect(nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('skips a dependency that resolves to no task, instead of drawing a dangling edge', () => {
    const downstream = task({ id: 'b', dependsOnStepIds: ['ghost-step'] });
    const { edges } = buildWorkyGraph([downstream]);
    expect(edges).toEqual([]);
  });

  it('handles tasks with no dependsOnStepIds at all (defensive against the API boundary)', () => {
    const legacy = task({ id: 'a' });
    delete (legacy as { dependsOnStepIds?: string[] }).dependsOnStepIds;
    expect(() => buildWorkyGraph([legacy])).not.toThrow();
  });
});
