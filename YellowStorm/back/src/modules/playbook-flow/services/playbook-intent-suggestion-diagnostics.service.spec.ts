import { PlaybookIntentSuggestionDiagnosticsService } from './playbook-intent-suggestion-diagnostics.service';

describe('PlaybookIntentSuggestionDiagnosticsService', () => {
  const service = new PlaybookIntentSuggestionDiagnosticsService();

  function workflowPlan(overrides: Record<string, unknown> = {}) {
    return {
      id: 'intent-blueprint',
      kind: 'workflow_plan',
      label: 'Plan',
      summary: '',
      reason: '',
      confidence: 0.85,
      impact: { nodesToCreate: 0, nodesToUpdate: 0, nodesToDelete: 0, edgesToCreate: 0, edgesToDelete: 0, dataBindingsToCreate: 0, dataBindingsToDelete: 0, affectedTaskIds: [], businessOutcome: '' },
      changes: [],
      isDirectIntentFallback: false,
      ...overrides,
    } as any;
  }

  it('attaches diagnostics and lowers confidence by severity', () => {
    const enriched = service.enrichWorkflowPlan(workflowPlan(), {}, [
      { severity: 'warning', stage: 'parser', code: 'warn', message: 'warn' },
      { severity: 'error', stage: 'graph_builder', code: 'error', message: 'error' },
    ]);

    expect(enriched.confidence).toBeCloseTo(0.65);
    expect(enriched.diagnostics).toHaveLength(2);
    expect(enriched.validationStatus).toBe('valid_with_warnings');
    expect(enriched.blockingReasons).toBeUndefined();
    expect(enriched.repairSummary).toBeNull();
  });

  it('marks warning-only suggestions as valid with warnings', () => {
    const enriched = service.enrichWorkflowPlan(workflowPlan(), {}, [
      { severity: 'warning', stage: 'parser', code: 'warn', message: 'warn' },
    ]);

    expect(enriched.validationStatus).toBe('valid_with_warnings');
    expect(enriched.blockingReasons).toBeUndefined();
  });

  it('marks clean suggestions as valid', () => {
    const enriched = service.enrichWorkflowPlan(workflowPlan(), {}, []);

    expect(enriched.validationStatus).toBe('valid');
    expect(enriched.blockingReasons).toBeUndefined();
  });

  it('keeps suggestions with final validation diagnostics apply-ready', () => {
    const enriched = service.enrichWorkflowPlan(workflowPlan({
      changes: [{
        type: 'create_node',
        nodeRef: 'draft',
        anchor: { mode: 'append', targetTaskId: null, nodeRef: null },
        task: {
          title: 'Draft',
          description: 'Draft',
          inputPorts: [{ id: 'context', artifactKind: 'text', required: true }],
        },
      }],
    }), {}, []);

    expect(enriched.validationStatus).toBe('valid_with_warnings');
    expect(enriched.validationDiagnostics?.length).toBeGreaterThan(0);
    expect(enriched.blockingReasons).toBeUndefined();
  });

  it('caps diagnostic confidence penalties', () => {
    const enriched = service.enrichWorkflowPlan(workflowPlan(), {}, Array.from({ length: 10 }, (_, index) => ({
      severity: 'error' as const,
      stage: 'graph_builder' as const,
      code: `error_${index}`,
      message: 'error',
    })));

    expect(enriched.confidence).toBeCloseTo(0.4);
  });

  it('prunes existing edges and bindings when validating delete-node drafts', () => {
    const enriched = service.enrichWorkflowPlan(workflowPlan({
      changes: [{ type: 'delete_node', targetTaskId: 'target-node' }],
    }), {
      nodes: [
        { id: 'source-node', kind: 'step', input: { ports: [] }, output: { ports: [{ id: 'summary', type: 'text' }] } },
        { id: 'target-node', kind: 'step', input: { ports: [{ id: 'prompt', type: 'text', required: true }] }, output: { ports: [] } },
      ] as any,
      controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'source-node', target: 'target-node' }] as any,
      dataBindings: [{ id: 'binding-1', targetNode: 'target-node', targetPort: 'prompt', sourceKind: 'node-output', sourceNode: 'source-node', sourcePort: 'summary' }] as any,
    }, []);

    expect(enriched.validationDiagnostics).toBeUndefined();
    expect(enriched.confidence).toBe(0.85);
    expect(enriched.validationStatus).toBe('valid');
  });
});
