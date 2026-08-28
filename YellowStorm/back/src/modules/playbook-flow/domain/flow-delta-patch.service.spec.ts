import { FlowDeltaPatchService } from './flow-delta-patch.service';
import { FlowGraphSanitizerService } from './flow-graph-sanitizer.service';
import { FlowWorkspacePolicyService } from './flow-workspace-policy.service';

describe('FlowDeltaPatchService', () => {
  it('builds a sanitized graph from structural node updates', () => {
    const service = new FlowDeltaPatchService(
      new FlowWorkspacePolicyService(),
      new FlowGraphSanitizerService(),
    );

    const result = service.buildPatchedGraph({
      workspaces: ['workspace-1'],
      nodes: [
        {
          id: 'task-1',
          kind: 'step',
          label: 'Draft',
          input: { ports: [{ id: 'input' }] },
          output: { ports: [{ id: 'output' }] },
          metadata: { positionX: 10, positionY: 20 },
        },
        {
          id: 'task-2',
          kind: 'step',
          label: 'Remove',
          input: { ports: [{ id: 'input' }] },
          output: { ports: [{ id: 'output' }] },
          metadata: { positionX: 30, positionY: 40 },
        },
      ],
      controlEdges: [
        { id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' },
      ],
      dataBindings: [
        {
          id: 'binding-1',
          targetNode: 'task-2',
          targetPort: 'input',
          sourceKind: 'node-output',
          sourceNode: 'task-1',
          sourcePort: 'output',
        },
      ],
    } as any, {
      expectedUpdatedAt: '2026-05-30T06:00:00.000Z',
      patch: {
        nodes: {
          deleteIds: ['task-2'],
          upserts: [
            {
              id: 'task-1',
              kind: 'step',
              label: 'Draft revised',
              input: { ports: [{ id: 'input' }] },
              output: { ports: [{ id: 'output' }] },
              metadata: { positionX: 11, positionY: 21 },
            },
            {
              id: 'task-3',
              kind: 'step',
              label: 'Added',
              input: { ports: [{ id: 'input' }] },
              output: { ports: [{ id: 'output' }] },
              metadata: { positionX: 50, positionY: 60 },
            },
          ],
        },
        controlEdges: [
          { id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3' },
        ],
        dataBindings: [
          {
            id: 'binding-2',
            targetNode: 'task-3',
            targetPort: 'input',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'output',
          },
        ],
      },
    } as any);

    expect(result.nodes).toEqual([
      expect.objectContaining({ id: 'task-1', label: 'Draft revised' }),
      expect.objectContaining({ id: 'task-3', label: 'Added' }),
    ]);
    expect(result.controlEdges).toEqual([
      { id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3' },
    ]);
    expect(result.dataBindings).toEqual([
      {
        id: 'binding-2',
        targetNode: 'task-3',
        targetPort: 'input',
        sourceKind: 'node-output',
        sourceNode: 'task-1',
        sourcePort: 'output',
      },
    ]);
    expect(result.scalarFieldCount).toBe(0);
    expect(result.nodesUpserted).toBe(2);
    expect(result.nodesDeleted).toBe(1);
    expect(result.edgeChanges).toBe(1);
    expect(result.dataBindingChanges).toBe(1);
    expect(result.positionUpdates).toBe(0);
  });

  it('preserves node ids from hydrated flow subdocuments', () => {
    const service = new FlowDeltaPatchService(
      new FlowWorkspacePolicyService(),
      new FlowGraphSanitizerService(),
    );
    const hydratedNode = {
      toObject: () => ({
        id: 'task-1',
        kind: 'step',
        label: 'Hydrated',
        metadata: { positionX: 10, positionY: 20 },
      }),
    };

    const result = service.buildPatchedGraph({
      workspaces: ['workspace-1'],
      nodes: [hydratedNode],
      controlEdges: [],
      dataBindings: [],
    } as any, {
      expectedUpdatedAt: '2026-05-30T06:00:00.000Z',
      patch: {
        nodes: {
          positionUpdates: [{ id: 'task-1', positionX: 15, positionY: 25 }],
        },
      },
    } as any);

    expect(result.nodes).toEqual([
      expect.objectContaining({
        id: 'task-1',
        metadata: expect.objectContaining({ positionX: 15, positionY: 25 }),
      }),
    ]);
  });

  it('allows a delta patch to persist without a default workspace', () => {
    const service = new FlowDeltaPatchService(
      new FlowWorkspacePolicyService(),
      new FlowGraphSanitizerService(),
    );

    const result = service.buildPatchedGraph({
      workspaces: [],
      nodes: [],
      controlEdges: [],
      dataBindings: [],
    } as any, {
      expectedUpdatedAt: '2026-05-30T06:00:00.000Z',
      patch: { fields: { workspaces: [] } },
    } as any);

    expect(result.normalizedWorkspaces).toEqual([]);
  });
});
