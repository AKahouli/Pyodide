import { describe, expect, it } from 'vitest';
import { migratePlaybook, migrateTask } from './migrate-ports';

describe('migrateTask', () => {
  it('normalizes iterator ports to the canonical items/results data ports', () => {
    const migrated = migrateTask({
      id: 'iterator-1',
      taskType: 'iterator',
      inputPorts: [{ id: 'legacy', name: 'Legacy', artifactKind: 'text', required: false }],
      outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
    });

    expect(migrated.inputPorts).toEqual([
      { id: 'items', name: 'Items', artifactKind: 'data', required: false },
    ]);
    expect(migrated.outputPorts).toEqual([
      { id: 'results', name: 'Results', artifactKind: 'data' },
    ]);
  });

  it('keeps non-iterator defaults unchanged', () => {
    const migrated = migrateTask({
      id: 'task-1',
      taskType: 'generic',
    });

    expect(migrated.inputPorts).toEqual([
      { id: 'default', name: 'Input', artifactKind: 'text', required: false },
    ]);
    expect(migrated.outputPorts).toEqual([
      { id: 'default', name: 'Output', artifactKind: 'text' },
    ]);
  });

  it('remaps iterator-connected edges to canonical handle ids', () => {
    const migrated = migratePlaybook(
      [
        {
          id: 'iterator-1',
          taskType: 'iterator',
          inputPorts: [{ id: 'legacy-in', name: 'Legacy In', artifactKind: 'text', required: false }],
          outputPorts: [{ id: 'legacy-out', name: 'Legacy Out', artifactKind: 'text' }],
        } as any,
        {
          id: 'task-2',
          taskType: 'generic',
          inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'data', required: false }],
          outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
        } as any,
      ],
      [
        {
          id: 'edge-1',
          sourceId: 'iterator-1',
          targetId: 'task-2',
          sourceOutputPortId: 'legacy-out',
          targetInputPortId: 'default',
        },
        {
          id: 'edge-2',
          sourceId: 'task-2',
          targetId: 'iterator-1',
          sourceOutputPortId: 'default',
          targetInputPortId: 'legacy-in',
        },
      ] as any,
    );

    expect(migrated.edges).toEqual([
      {
        id: 'edge-1',
        sourceId: 'iterator-1',
        targetId: 'task-2',
        sourceOutputPortId: 'results',
        targetInputPortId: 'default',
      },
      {
        id: 'edge-2',
        sourceId: 'task-2',
        targetId: 'iterator-1',
        sourceOutputPortId: 'default',
        targetInputPortId: 'items',
      },
    ]);
  });
});
