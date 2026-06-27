import { describe, expect, it } from 'vitest';
import { playbookEdgesToFlowEdges, resolveIntentEdgePorts } from './control-edge-serializer';
import type { PlaybookEdge, PlaybookTask } from '../../types';

describe('playbookEdgesToFlowEdges', () => {
  it('preserves explicit iterator context input ports', () => {
    const edges: PlaybookEdge[] = [{
      id: 'edge-template',
      sourceId: 'loader',
      targetId: 'iterator',
      sourceOutputPortId: 'output_2',
      targetInputPortId: 'template_doc',
    }];
    const tasks = [
      {
        id: 'loader',
        outputPorts: [{ id: 'output_2', name: 'Generated document', artifactKind: 'document' }],
      },
      {
        id: 'iterator',
        nodeType: 'iterator',
        inputPorts: [
          { id: 'items', name: 'Items', artifactKind: 'data', required: false },
          { id: 'template_doc', name: 'Template Document', artifactKind: 'document', required: false },
        ],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
      },
    ] as PlaybookTask[];

    const [edge] = playbookEdgesToFlowEdges(edges, tasks);

    expect(edge.targetHandle).toBe('template_doc');
    expect(edge.data).toEqual(expect.objectContaining({ targetInputPortId: 'template_doc' }));
  });

  it('falls back legacy iterator edges to canonical collection and result ports', () => {
    const edges: PlaybookEdge[] = [{
      id: 'edge-legacy',
      sourceId: 'source-iterator',
      targetId: 'target-iterator',
      sourceOutputPortId: 'default',
      targetInputPortId: 'default',
    }];
    const tasks = [
      {
        id: 'source-iterator',
        nodeType: 'iterator',
        inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
      },
      {
        id: 'target-iterator',
        nodeType: 'iterator',
        inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
      },
    ] as PlaybookTask[];

    const [edge] = playbookEdgesToFlowEdges(edges, tasks);

    expect(edge.sourceHandle).toBe('results');
    expect(edge.targetHandle).toBe('items');
    expect(edge.data).toEqual(expect.objectContaining({
      sourceOutputPortId: 'results',
      targetInputPortId: 'items',
    }));
  });
});

describe('resolveIntentEdgePorts', () => {
  it('preserves exact requested ports for visual edges when artifact kinds differ', () => {
    const sourceTask = {
      id: 'collect_rh_cvs',
      outputPorts: [{ id: 'output-1', name: 'CV file references', artifactKind: 'text' }],
    } as PlaybookTask;
    const targetTask = {
      id: 'reformat_cvs',
      nodeType: 'iterator',
      inputPorts: [{ id: 'items', name: 'CV items', artifactKind: 'data', required: false }],
    } as PlaybookTask;

    expect(resolveIntentEdgePorts(sourceTask, targetTask, 'output-1', 'items')).toEqual({
      sourceOutputPortId: 'output-1',
      targetInputPortId: 'items',
    });
  });
});
