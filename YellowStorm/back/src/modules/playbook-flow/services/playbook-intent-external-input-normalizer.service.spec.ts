import { PlaybookIntentExternalInputNormalizerService } from './playbook-intent-external-input-normalizer.service';

describe('PlaybookIntentExternalInputNormalizerService', () => {
  const service = new PlaybookIntentExternalInputNormalizerService();
  const context = (resources: any[] = []) => ({
    flow: { nodes: [], controlEdges: [], dataBindings: [] },
    resolvedDesignResources: resources,
  } as any);
  const suggestion = (title: string, port: string, type = 'document') => ({
    id: 's1', kind: 'workflow_plan', label: 'Plan', summary: '', reason: '', confidence: 0.9,
    impact: { nodesToCreate: 1, nodesToUpdate: 0, nodesToDelete: 0, edgesToCreate: 0, edgesToDelete: 0, dataBindingsToCreate: 0, dataBindingsToDelete: 0, affectedTaskIds: [], businessOutcome: '' },
    changes: [{
      type: 'create_node', nodeRef: 'extract-pdf', anchor: { mode: 'append', targetTaskId: null, nodeRef: null },
      task: { title, description: '', inputPorts: [{ id: port, artifactKind: type, required: true }], outputPorts: [] },
    }],
    isDirectIntentFallback: false,
  } as any);

  it('creates a managed trigger for an external required runtime port', () => {
    const result = service.normalize(suggestion('Extract PDF', 'pdf-document'), context());
    expect(result.suggestion.changes).toContainEqual(expect.objectContaining({
      type: 'create_data_binding', sourceKind: 'trigger', targetNodeRef: 'extract-pdf', targetPort: 'pdf-document',
      triggerPath: 'playbookInputs.extract_pdf_pdf_document',
    }));
  });

  it('uses one trusted destination workspace and never an untrusted proposed id', () => {
    const plan = suggestion('Save to Destination Workspace', 'destination-workspace', 'data');
    plan.changes.push({
      type: 'create_data_binding', targetTaskId: null, targetNodeRef: 'extract-pdf', targetPort: 'destination-workspace',
      sourceKind: 'constant', constantValue: { kind: 'workspace', id: 'fabricated', workspaceId: 'fabricated' },
    });
    const result = service.normalize(plan, context([{ question: '', label: 'CV', kind: 'workspace', id: 'w1', workspaceId: 'w1' }]));
    expect(result.suggestion.changes).toContainEqual(expect.objectContaining({
      sourceKind: 'constant', constantValue: expect.objectContaining({ id: 'w1', workspaceId: 'w1' }),
    }));
    expect(JSON.stringify(result.suggestion.changes)).not.toContain('fabricated');
  });
});
