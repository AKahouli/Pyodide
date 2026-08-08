import { sanitizeExecutionForResponse, sanitizeExecutionSnapshotForResponse } from './playbook-flow-execution.service';

describe('Dynamic Reasoning execution privacy', () => {
  it('removes the planner prompt from execution response snapshots without mutating persistence data', () => {
    const snapshot = {
      nodes: [],
      playbookPlanner: { systemPrompt: 'private planner instruction', promptHash: 'sha256:test' },
      playbookExecutionSettings: { availableCapacity: 4 },
    };
    const result = sanitizeExecutionSnapshotForResponse(snapshot);
    expect(result).toEqual({ nodes: [], playbookExecutionSettings: { availableCapacity: 4 } });
    expect(snapshot.playbookPlanner.systemPrompt).toBe('private planner instruction');
  });

  it('removes planner material from the immediate execution start response', () => {
    const persisted = {
      id: 'execution-1',
      snapshot: {
        nodes: [],
        playbookPlanner: { systemPrompt: 'private planner instruction' },
      },
      playbookPlannerSnapshot: { systemPrompt: 'private planner instruction' },
    };

    const response = sanitizeExecutionForResponse(persisted as never) as unknown as Record<string, unknown>;

    expect(response).not.toHaveProperty('playbookPlannerSnapshot');
    expect(response.snapshot).toEqual({ nodes: [] });
    expect(persisted.snapshot.playbookPlanner.systemPrompt).toBe('private planner instruction');
  });
});
