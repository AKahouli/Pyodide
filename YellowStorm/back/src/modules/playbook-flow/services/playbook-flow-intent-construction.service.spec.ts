import { PlaybookFlowIntentConstructionService } from './playbook-flow-intent-construction.service';

describe('PlaybookFlowIntentConstructionService', () => {
  function createService(): PlaybookFlowIntentConstructionService {
    return new PlaybookFlowIntentConstructionService({
      normalizeConstructionSuggestions: jest.fn().mockReturnValue([]),
    } as any);
  }

  it('uses the default large workflow limit during realtime construction normalization', () => {
    const normalizeConstructionSuggestions = jest.fn().mockReturnValue([]);
    const service = new PlaybookFlowIntentConstructionService({
      normalizeConstructionSuggestions,
    } as any);

    (service as any).normalizeRawSuggestions(
      '{"suggestions":[]}',
      { intent: 'build a large workflow' },
      {
        selectedNodeId: null,
        limits: {
          maxWorkflowPlanChanges: 50,
          maxInputPorts: 4,
          maxOutputPorts: 4,
          maxIteratorBodySteps: 12,
          maxIteratorBodyEdges: 50,
        },
        validationContext: {},
      },
    );

    expect(normalizeConstructionSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      limits: expect.objectContaining({ maxWorkflowPlanChanges: 500 }),
    }));
  });

  it('reads a final chat completion stream line without a trailing newline', async () => {
    const service = createService();
    const payload = JSON.stringify({ choices: [{ delta: { content: 'tail content' } }] });
    const stream = [Buffer.from(`data: ${payload}`)];

    const chunks: string[] = [];
    for await (const content of (service as any).readChatCompletionStream(stream)) {
      chunks.push(content);
    }

    expect(chunks).toEqual(['tail content']);
  });

  describe('blueprint path', () => {
    function makeContext(useBlueprint: boolean) {
      const validationContext = {
        existingTaskIds: new Set<string>(),
        existingTaskTitles: new Map<string, string>(),
        existingTaskAgents: new Map<string, string | null>(),
        inputPortsByTaskId: new Map<string, Map<string, string>>(),
        outputPortsByTaskId: new Map<string, Map<string, string>>(),
        existingBindingTargets: new Set<string>(),
      };
      return {
        selectedNodeId: null,
        effectiveSettings: { useDeterministicBlueprintBuilder: useBlueprint },
        limits: { maxWorkflowPlanChanges: 500, maxInputPorts: 4, maxOutputPorts: 4, maxIteratorBodySteps: 12, maxIteratorBodyEdges: 50 },
        validationContext,
        nodeTemplates: [],
        httpClient: { post: jest.fn() },
        flow: {},
        model: 'm',
        systemPrompt: '',
        userPrompt: '',
        promptVariables: {},
      };
    }

    it('produces a builder-driven workflow_plan suggestion when the blueprint flag is enabled and a blueprint is present', () => {
      const service = new PlaybookFlowIntentConstructionService({
        normalizeConstructionSuggestions: jest.fn((args: { dto: { intent: string } }) => [
          {
            id: 'intent-fallback',
            kind: 'single_change',
            label: '',
            summary: args.dto.intent,
            reason: '',
            confidence: 1,
            operationType: 'create_node',
            task: { title: args.dto.intent.slice(0, 120), description: args.dto.intent },
            targetTaskId: null,
            isDirectIntentFallback: true,
          },
        ]),
      } as any);

      const raw = JSON.stringify({
        blueprint: {
          title: 'Linear',
          summary: 'Two steps',
          nodes: [
            { ref: 'collect', label: 'Collect', purpose: 'Gather', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
            { ref: 'draft', label: 'Draft', purpose: 'Write', inputPorts: [{ id: 'data', artifactKind: 'data', required: true }] },
          ],
          links: [{ sourceRef: 'collect', targetRef: 'draft', sourceOutputPortId: 'data', targetInputPortId: 'data' }],
        },
      });

      const suggestions = (service as any).buildBlueprintSuggestions(raw, makeContext(true), { intent: 'test' });
      expect(suggestions.length).toBe(2);
      const plan = suggestions.find((s: any) => s.kind === 'workflow_plan');
      expect(plan).toBeDefined();
      expect(plan.changes.filter((c: any) => c.type === 'create_node')).toHaveLength(2);
    });

    it('emits blueprint workflow plans as one complete delta with bindings included', async () => {
      const service = createService();
      const job = {
        id: 'construction-1',
        flowId: 'flow-1',
        events: [],
        abortController: new AbortController(),
        waiters: new Set<() => void>(),
      };
      const suggestion = {
        id: 'intent-blueprint',
        kind: 'workflow_plan',
        label: 'Plan',
        summary: '',
        reason: '',
        confidence: 0.8,
        isDirectIntentFallback: false,
        impact: { nodesToCreate: 2, nodesToUpdate: 0, nodesToDelete: 0, edgesToCreate: 1, edgesToDelete: 0, dataBindingsToCreate: 1, dataBindingsToDelete: 0, affectedTaskIds: [], businessOutcome: '' },
        changes: [
          { type: 'create_node', nodeRef: 'a', anchor: { mode: 'append', targetTaskId: null, nodeRef: null }, task: { title: 'A', description: 'A' } },
          { type: 'create_node', nodeRef: 'b', anchor: { mode: 'append', targetTaskId: null, nodeRef: null }, task: { title: 'B', description: 'B', inputPorts: [{ id: 'input', artifactKind: 'text', required: true }] } },
          { type: 'create_edge', sourceTaskId: null, sourceNodeRef: 'a', targetTaskId: null, targetNodeRef: 'b', sourceOutputPortId: 'output', targetInputPortId: 'input' },
          { type: 'create_data_binding', targetTaskId: null, targetNodeRef: 'b', targetPort: 'input', sourceKind: 'node-output', sourceTaskId: null, sourceNodeRef: 'a', sourcePort: 'output', iteration: 'current' },
        ],
      };

      await (service as any).emitSuggestions(job, [suggestion], 0, false);

      const deltaEvents = (job.events as any[]).filter((event: any) => event.type.endsWith('_delta'));
      expect(deltaEvents).toHaveLength(1);
      expect(deltaEvents[0].suggestion.changes).toHaveLength(4);
      expect(deltaEvents[0].suggestion.changes.some((change: any) => change.type === 'create_data_binding')).toBe(true);
    });

    it('falls back to legacy normalization when the blueprint flag is disabled', () => {
      const normalizeConstructionSuggestions = jest.fn().mockReturnValue([{ id: 'legacy', kind: 'single_change' }]);
      const service = new PlaybookFlowIntentConstructionService({ normalizeConstructionSuggestions } as any);
      const raw = JSON.stringify({ blueprint: { title: 'x', summary: '', nodes: [], links: [] } });
      const suggestions = (service as any).buildBlueprintSuggestions(raw, makeContext(false), { intent: 'test' });
      expect(normalizeConstructionSuggestions).toHaveBeenCalled();
      expect(suggestions[0]).toEqual({ id: 'legacy', kind: 'single_change' });
    });

    it('falls back to legacy normalization when the raw payload has no blueprint shape', () => {
      const normalizeConstructionSuggestions = jest.fn().mockReturnValue([{ id: 'legacy', kind: 'single_change' }]);
      const service = new PlaybookFlowIntentConstructionService({ normalizeConstructionSuggestions } as any);
      const suggestions = (service as any).buildBlueprintSuggestions(
        JSON.stringify({ suggestions: [] }),
        makeContext(true),
        { intent: 'test' },
      );
      expect(normalizeConstructionSuggestions).toHaveBeenCalled();
      expect(suggestions[0]).toEqual({ id: 'legacy', kind: 'single_change' });
    });
  });
});
