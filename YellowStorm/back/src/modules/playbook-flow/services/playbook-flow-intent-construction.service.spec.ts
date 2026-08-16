import { PlaybookFlowIntentConstructionService } from './playbook-flow-intent-construction.service';

describe('PlaybookFlowIntentConstructionService', () => {
  function createService(): PlaybookFlowIntentConstructionService {
    return new PlaybookFlowIntentConstructionService({
      normalizeConstructionSuggestions: jest.fn().mockReturnValue([]),
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

  it('aborts a local worker when another replica durably cancels its operation', async () => {
    jest.useFakeTimers();
    const operationService = {
      getStatus: jest.fn().mockResolvedValue({ status: 'cancelled' }),
    };
    const service = new PlaybookFlowIntentConstructionService(
      { normalizeConstructionSuggestions: jest.fn() } as any,
      undefined,
      operationService as any,
    );
    const job = {
      id: 'operation-1',
      flowId: 'flow-1',
      ownerId: 'owner-1',
      status: 'running',
      events: [],
      abortController: new AbortController(),
      waiters: new Set(),
    };

    try {
      const timer = (service as any).watchDurableCancellation(job);
      await jest.advanceTimersByTimeAsync(500);
      expect(job.abortController.signal.aborted).toBe(true);
      expect(job.status).toBe('cancelled');
      clearInterval(timer);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not append after a durable terminal event wins on another replica', async () => {
    const operationService = {
      append: jest.fn().mockRejectedValue(new Error('terminal conflict')),
      getStatus: jest.fn().mockResolvedValue({ status: 'cancelled' }),
    };
    const service = new PlaybookFlowIntentConstructionService(
      { normalizeConstructionSuggestions: jest.fn() } as any,
      undefined,
      operationService as any,
    );
    const job = {
      id: 'operation-1',
      flowId: 'flow-1',
      ownerId: 'owner-1',
      status: 'running',
      events: [],
      abortController: new AbortController(),
      waiters: new Set(),
    };

    await expect((service as any).emit(job, {
      type: 'progress',
      constructionId: 'operation-1',
      playbookId: 'flow-1',
      phase: 'planning',
      message: 'Planning',
    })).resolves.toBeUndefined();
    expect(job.abortController.signal.aborted).toBe(true);
    expect(job.events).toEqual([]);
  });

  it.each([
    { omitTemperature: true, expectedTemperature: undefined },
    { omitTemperature: false, expectedTemperature: 0.2 },
  ])('uses model temperature capability during streamed construction', async ({ omitTemperature, expectedTemperature }) => {
    jest.useFakeTimers();
    const service = createService();
    const context = {
      selectedNodeId: null,
      effectiveSettings: { useDeterministicBlueprintBuilder: true },
      limits: { maxWorkflowPlanChanges: 500, maxInputPorts: 4, maxOutputPorts: 4, maxIteratorBodySteps: 12, maxIteratorBodyEdges: 50 },
      validationContext: {},
      availableDesignCatalog: { availableSkills: [], availableConnectors: [], availableConnectorActions: [], availableWorkspaces: [] },
      nodeTemplates: [],
      httpClient: { post: jest.fn().mockResolvedValue({ data: [] }) },
      flow: {},
      model: 'azure/gpt-5.6-luna',
      omitTemperature,
      systemPrompt: '',
      userPrompt: '',
      userMessageContent: '',
      promptVariables: {},
    };
    const job = {
      id: 'construction-temperature',
      flowId: 'flow-1',
      ownerId: 'owner-1',
      status: 'queued',
      baseDefinitionRevision: 1,
      events: [],
      abortController: new AbortController(),
      waiters: new Set<() => void>(),
    };

    try {
      await (service as any).run(job, { intent: 'Build workflow' }, context);

      const payload = context.httpClient.post.mock.calls[0][1];
      if (expectedTemperature === undefined) expect(payload).not.toHaveProperty('temperature');
      else expect(payload).toHaveProperty('temperature', expectedTemperature);
    } finally {
      jest.useRealTimers();
    }
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

      const suggestions = (service as any).buildBlueprintSuggestions(raw, makeContext(true));
      expect(normalizeConstructionSuggestions).not.toHaveBeenCalled();
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].kind).toBe('workflow_plan');
      expect(suggestions[0].changes.filter((c: any) => c.type === 'create_node')).toHaveLength(2);
      expect(suggestions[0].changes.some((c: any) => c.type === 'create_node' && c.task.title === 'test')).toBe(false);
    });

    it('accepts compiled blueprint routers with an intentionally unlinked branch', () => {
      const service = new PlaybookFlowIntentConstructionService({
        normalizeConstructionSuggestions: jest.fn(),
      } as any);
      const context = makeContext(true);
      context.nodeTemplates = [
        ...context.nodeTemplates,
        { id: 'tpl-router', key: 'router.template', nodeType: 'router', title: 'Router', category: 'control', inputPorts: [], outputPorts: [], recommendedAgentTypeSlug: null, enabled: true },
      ];
      const raw = JSON.stringify({
        blueprint: {
          version: 2,
          title: 'Route one branch',
          summary: 'Router missing one label edge',
          nodes: [
            { ref: 'classify', label: 'Classify', purpose: '', nodeTemplateKey: 'router.template', primitive: { kind: 'router', router: { outputLabels: ['yes', 'no'], defaultLabel: 'no' } } },
            { ref: 'yes_step', label: 'Yes', purpose: '', nodeTemplateKey: 'generic.agent_step' },
          ],
          links: [{ sourceRef: 'classify', targetRef: 'yes_step', kind: 'conditional', routerLabel: 'yes' }],
        },
      });

      const suggestions = (service as any).buildBlueprintSuggestions(raw, context);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].diagnostics.some((diagnostic: any) => diagnostic.stage === 'invariant_validator' && diagnostic.code === 'validator_rule_4')).toBe(false);
      expect(suggestions[0].validationDiagnostics).toBeUndefined();
      expect(suggestions[0].diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: 'repair', code: 'repair_router_link_source_port_set' }),
      ]));
      expect(suggestions[0].validationStatus).toBe('valid_with_warnings');
      expect(suggestions[0].blockingReasons).toBeUndefined();
      expect(suggestions[0].repairSummary).toContain('Set router link source port to yes.');
    });

    it('emits blueprint workflow plans as progressive cumulative deltas', async () => {
      jest.useFakeTimers();
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

      try {
        const emitPromise = (service as any).emitSuggestions(job, [suggestion]);
        await jest.runAllTimersAsync();
        await emitPromise;

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
      } finally {
        jest.useRealTimers();
      }
    });

    it('returns no suggestions when the raw payload has no blueprint shape', () => {
      const normalizeConstructionSuggestions = jest.fn().mockReturnValue([{ id: 'legacy', kind: 'single_change' }]);
      const service = new PlaybookFlowIntentConstructionService({ normalizeConstructionSuggestions } as any);
      const suggestions = (service as any).buildBlueprintSuggestions(
        JSON.stringify({ suggestions: [] }),
        makeContext(true),
      );
      expect(normalizeConstructionSuggestions).not.toHaveBeenCalled();
      expect(suggestions).toEqual([]);
    });
  });
});
