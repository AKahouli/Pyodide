import { PlaybookFlowIntentConstructionService } from './playbook-flow-intent-construction.service';

describe('PlaybookFlowIntentConstructionService', () => {
  function createService(): PlaybookFlowIntentConstructionService {
    return new PlaybookFlowIntentConstructionService({
      normalizeConstructionSuggestions: jest.fn().mockReturnValue([]),
      buildGraphBuilderDesignCatalog: jest.fn().mockReturnValue({ connectors: [], connectorActions: [], skills: [] }),
    } as any);
  }

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
        availableDesignCatalog: { availableSkills: [], availableConnectors: [], availableConnectorActions: [], availableWorkspaces: [] },
        nodeTemplates: [{
          id: 'tpl-generic', key: 'generic.agent_step', nodeType: 'agent', title: 'Generic', category: 'general',
          inputPorts: [], outputPorts: [], recommendedAgentTypeSlug: null, enabled: true,
        }],
        httpClient: { post: jest.fn() },
        flow: {},
        model: 'm',
        systemPrompt: '',
        userPrompt: '',
        userMessageContent: '',
        promptVariables: {},
      };
    }

    it('produces only a builder-driven workflow_plan suggestion when the blueprint flag is enabled and a blueprint is present', () => {
      const normalizeConstructionSuggestions = jest.fn();
      const service = new PlaybookFlowIntentConstructionService({
        normalizeConstructionSuggestions,
        buildGraphBuilderDesignCatalog: jest.fn().mockReturnValue({ connectors: [], connectorActions: [], skills: [] }),
      } as any);

      const raw = JSON.stringify({
        blueprint: {
          title: 'Linear',
          summary: 'Two steps',
          nodes: [
            { ref: 'collect', label: 'Collect', purpose: 'Gather', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
            { ref: 'draft', label: 'Draft', purpose: 'Write', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'data', artifactKind: 'data', required: true }] },
          ],
          links: [{ sourceRef: 'collect', targetRef: 'draft', sourceOutputPortId: 'data', targetInputPortId: 'data' }],
        },
      });

      const suggestions = (service as any).buildBlueprintSuggestions(raw, makeContext(true), { intent: 'test' });
      expect(normalizeConstructionSuggestions).not.toHaveBeenCalled();
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].kind).toBe('workflow_plan');
      expect(suggestions[0].changes.filter((c: any) => c.type === 'create_node')).toHaveLength(2);
      expect(suggestions[0].changes.some((c: any) => c.type === 'create_node' && c.task.title === 'test')).toBe(false);
    });

    it('emits blueprint workflow plans as progressive cumulative deltas', async () => {
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

      await (service as any).emitSuggestions(job, [suggestion]);

      const deltaEvents = (job.events as any[]).filter((event: any) => event.type.endsWith('_delta'));
      expect(deltaEvents).toHaveLength(4);
      expect(deltaEvents.map((event: any) => event.type)).toEqual([
        'node_delta',
        'node_delta',
        'edge_delta',
        'data_binding_delta',
      ]);
      expect(deltaEvents.map((event: any) => event.suggestion.changes.length)).toEqual([1, 2, 3, 4]);
      expect(deltaEvents[3].suggestion.changes.some((change: any) => change.type === 'create_data_binding')).toBe(true);
      expect(deltaEvents.some((event: any) => event.suggestion.id === 'intent-fallback' || event.suggestion.isDirectIntentFallback)).toBe(false);
    });

    it('returns no suggestions when the raw payload has no blueprint shape', () => {
      const normalizeConstructionSuggestions = jest.fn().mockReturnValue([{ id: 'legacy', kind: 'single_change' }]);
      const service = new PlaybookFlowIntentConstructionService({ normalizeConstructionSuggestions } as any);
      const suggestions = (service as any).buildBlueprintSuggestions(
        JSON.stringify({ suggestions: [] }),
        makeContext(true),
        { intent: 'test' },
      );
      expect(normalizeConstructionSuggestions).not.toHaveBeenCalled();
      expect(suggestions).toEqual([]);
    });
  });
});
