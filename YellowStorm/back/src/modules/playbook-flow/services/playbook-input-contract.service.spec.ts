import { PlaybookInputContractService } from './playbook-input-contract.service';

describe('PlaybookInputContractService', () => {
  const service = new PlaybookInputContractService();
  const node = (id: string, label: string, portId: string, type = 'text') => ({
    id, kind: 'step', label, description: '',
    input: { ports: [{ id: portId, label: portId, type, required: true }] },
    output: { ports: [] },
  });

  it('includes managed triggers and configured constants but excludes internal bindings', () => {
    const result = service.derive({
      id: 'flow-1', definitionRevision: 4,
      nodes: [
        { ...node('source', 'Source', 'unused'), input: { ports: [] }, output: { ports: [{ id: 'out', type: 'text' }] } },
        node('runtime', 'Inspect URL', 'url'),
        node('destination', 'Save to Destination Workspace', 'destination-workspace'),
        node('internal', 'Internal', 'prompt'),
      ] as any,
      controlEdges: [{ id: 'e1', kind: 'sequential', source: 'source', target: 'internal' }] as any,
      dataBindings: [
        { id: 'b1', targetNode: 'runtime', targetPort: 'url', sourceKind: 'trigger', triggerPath: 'playbookInputs.runtime_url' },
        { id: 'b2', targetNode: 'destination', targetPort: 'destination-workspace', sourceKind: 'constant', constantValue: { kind: 'workspace', id: 'w1', workspaceId: 'w1', label: 'CV' } },
        { id: 'b3', targetNode: 'internal', targetPort: 'prompt', sourceKind: 'node-output', sourceNode: 'source', sourcePort: 'out' },
      ] as any,
    });

    expect(result).toMatchObject({ graphValid: true, configurationReady: true, runtimeInputCount: 1, invalidInputCount: 0 });
    expect(result.inputs).toEqual([
      expect.objectContaining({ id: 'runtime:url', readiness: 'runtime_required', acceptedSources: ['manual', 'url'] }),
      expect.objectContaining({ id: 'destination:destination-workspace', readiness: 'configured', scope: 'configuration' }),
    ]);
  });

  it('marks malformed or missing required bindings invalid', () => {
    const result = service.derive({
      id: 'flow-1', definitionRevision: 1,
      nodes: [node('runtime', 'Runtime', 'payload')] as any,
      controlEdges: [], dataBindings: [],
    });
    expect(result).toMatchObject({ graphValid: false, configurationReady: false, invalidInputCount: 1 });
    expect(result.inputs[0]).toMatchObject({ readiness: 'invalid', binding: { kind: 'missing' } });
  });

  it.each([
    ['manual text', 'workspace-1'],
    ['unknown object', { kind: 'bucket', id: 'workspace-1', workspaceId: 'workspace-1' }],
    ['document', { kind: 'document', id: 'doc-1', workspaceId: 'workspace-1' }],
    ['mismatched workspace', { kind: 'workspace', id: 'workspace-2', workspaceId: 'workspace-1' }],
    ['incomplete folder', { kind: 'folder', id: 'folder-1' }],
  ])('does not treat a %s constant as a configured destination', (_label, constantValue) => {
    const result = service.derive({
      id: 'flow-1', definitionRevision: 1,
      nodes: [node('destination', 'Save to Destination Workspace', 'destination', 'data')] as any,
      controlEdges: [],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'destination',
        targetPort: 'destination',
        sourceKind: 'constant',
        constantValue,
      }] as any,
    });

    expect(result).toMatchObject({ configurationReady: false });
    expect(result.inputs[0]).toMatchObject({ scope: 'configuration', readiness: 'configuration_required' });
  });

  it('accepts structurally valid workspace and folder destinations', () => {
    const nodes = [
      node('workspace', 'Save to Destination Workspace', 'destination-workspace', 'data'),
      node('folder', 'Save to Destination Folder', 'destination-folder', 'text'),
    ];
    const result = service.derive({
      id: 'flow-1', definitionRevision: 1,
      nodes: nodes as any,
      controlEdges: [],
      dataBindings: [
        { id: 'b1', targetNode: 'workspace', targetPort: 'destination-workspace', sourceKind: 'constant', constantValue: { kind: 'workspace', id: 'w1', workspaceId: 'w1' } },
        { id: 'b2', targetNode: 'folder', targetPort: 'destination-folder', sourceKind: 'constant', constantValue: { kind: 'folder', id: 'f1', workspaceId: 'w1' } },
      ] as any,
    });

    expect(result.configurationReady).toBe(true);
    expect(result.inputs.map((input) => input.readiness)).toEqual(['configured', 'configured']);
  });
});
