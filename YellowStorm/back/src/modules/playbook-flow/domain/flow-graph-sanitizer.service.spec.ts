import { FlowGraphSanitizerService } from './flow-graph-sanitizer.service';

describe('FlowGraphSanitizerService', () => {
  it('removes orphaned edges and stale bindings', () => {
    const service = new FlowGraphSanitizerService();

    const result = service.sanitize({
      nodes: [
        {
          id: 'task-1',
          kind: 'step',
          input: { ports: [{ id: 'input' }] },
          output: { ports: [{ id: 'output' }] },
        } as any,
        {
          id: 'task-2',
          kind: 'step',
          input: { ports: [{ id: 'input' }] },
          output: { ports: [{ id: 'output' }] },
        } as any,
      ],
      controlEdges: [
        { id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' } as any,
        { id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'missing' } as any,
      ],
      dataBindings: [
        {
          id: 'binding-1',
          targetNode: 'task-2',
          targetPort: 'input',
          sourceKind: 'node-output',
          sourceNode: 'task-1',
          sourcePort: 'output',
        } as any,
        {
          id: 'binding-2',
          targetNode: 'task-2',
          targetPort: 'missing',
          sourceKind: 'node-output',
          sourceNode: 'task-1',
          sourcePort: 'output',
        } as any,
        {
          id: 'binding-3',
          targetNode: 'missing',
          targetPort: 'input',
          sourceKind: 'trigger',
        } as any,
      ],
    });

    expect(result.controlEdges).toEqual([
      { id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' },
    ]);
    expect(result.dataBindings).toEqual([
      {
        id: 'binding-1',
        targetNode: 'task-2',
        targetPort: 'input',
        sourceKind: 'node-output',
        sourceNode: 'task-1',
        sourcePort: 'output',
      },
    ]);
    expect(result.removedOrphanedEdgeCount).toBe(1);
    expect(result.removedOrphanedBindingCount).toBe(1);
    expect(result.removedStaleBindingCount).toBe(1);
  });
});
