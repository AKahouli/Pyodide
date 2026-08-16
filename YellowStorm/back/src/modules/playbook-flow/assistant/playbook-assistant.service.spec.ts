import { PlaybookAssistantService } from './playbook-assistant.service';

describe('PlaybookAssistantService.runTurn', () => {
  const createService = (overrides: {
    taskResult?: { text: string; toolResults: Array<{ name: string; status: 'completed' | 'failed'; result: unknown }> };
    constructionStatus?: Record<string, unknown>;
  } = {}) => {
    const accessService = { findAccessibleFlow: jest.fn().mockResolvedValue({ definitionRevision: 7 }) };
    const constructionService = {
      start: jest.fn().mockResolvedValue({
        operationId: 'operation-1',
        playbookId: 'playbook-1',
        baseDefinitionRevision: 7,
      }),
      getStatus: jest.fn().mockResolvedValue(overrides.constructionStatus ?? {
        operationId: 'operation-1',
        playbookId: 'playbook-1',
        baseDefinitionRevision: 7,
        status: 'running',
        lastSequence: 1,
      }),
    };
    const agentService = { findActiveDefaultAgentIdBySlug: jest.fn().mockResolvedValue('507f1f77bcf86cd799439011') };
    const taskExecutionService = {
      runSingleAgentTask: jest.fn().mockResolvedValue(overrides.taskResult ?? { text: 'This workflow has two tasks.', toolResults: [] }),
    };
    const requestService = {
      claimTurn: jest.fn().mockResolvedValue({
        replay: false,
        request: {
          requestId: 'request-1',
          conversationId: 'conversation-1',
          correlationId: 'playbook-assistant:correlation-1',
          tenantId: 'default',
          agentId: '507f1f77bcf86cd799439011',
          contextId: 'context-1',
          originalText: 'request',
          mutationOperationId: null,
        },
      }),
      getContinuationForUser: jest.fn(),
      getByContinuation: jest.fn().mockResolvedValue({
        requestId: 'request-1',
        ownerId: 'user-1',
        playbookId: 'playbook-1',
        expectedDefinitionRevision: 7,
        originalText: 'Build lead scoring',
        selectedTaskId: null,
        attachmentIds: [],
        assessment: {
          questions: [{ id: 'region', required: true }],
        },
      }),
      getBound: jest.fn().mockResolvedValue({
        requestId: 'request-1',
        ownerId: 'user-1',
        playbookId: 'playbook-1',
        expectedDefinitionRevision: 7,
        operationKind: 'existing_construction',
        status: 'ready',
        originalText: 'Add scoring',
        selectedTaskId: null,
        attachmentIds: [],
        contextId: 'context-1',
      }),
      claimMutation: jest.fn().mockImplementation(async (_requestId: string, operationId: string) => operationId),
      releaseMutation: jest.fn().mockResolvedValue(undefined),
      bindGeneratedPlaybook: jest.fn().mockResolvedValue(undefined),
      resetMutation: jest.fn().mockResolvedValue(true),
      claimAssessment: jest.fn().mockResolvedValue(1),
      claimContinuation: jest.fn().mockResolvedValue(2),
      restoreContinuation: jest.fn().mockResolvedValue(undefined),
      saveAssessment: jest.fn(),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const historyService = { append: jest.fn().mockResolvedValue(undefined), list: jest.fn().mockResolvedValue({ conversationId: null, messages: [] }) };
    const attachmentService = {
      assertBindings: jest.fn().mockResolvedValue(undefined),
      resolveImages: jest.fn().mockResolvedValue([]),
    };
    const flowService = {
      create: jest.fn().mockResolvedValue({ id: 'generated-playbook-1', definitionRevision: 0 }),
      findByAssistantOperationId: jest.fn(),
      removeAssistantDraftIfUnchanged: jest.fn().mockResolvedValue(true),
    };
    const intentService = { assessDesign: jest.fn() };
    const service = new PlaybookAssistantService(
      { mcpAssistantEnabled: true } as any,
      {} as any,
      accessService as any,
      constructionService as any,
      {} as any,
      flowService as any,
      {} as any,
      {} as any,
      agentService as any,
      taskExecutionService as any,
      requestService as any,
      historyService as any,
      intentService as any,
      attachmentService as any,
    );
    return { service, accessService, constructionService, flowService, agentService, taskExecutionService, requestService, historyService, intentService, attachmentService };
  };

  it('returns a read-only assistant answer without creating an operation', async () => {
    const { service, taskExecutionService } = createService();

    await expect(service.runTurn('playbook-1', 'user-1', {
      message: 'How many tasks are there?',
      expectedDefinitionRevision: 7,
      selectedTaskId: 'task-1',
    })).resolves.toEqual({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      answer: 'This workflow has two tasks.',
      assessment: null,
      operation: null,
    });
    expect(taskExecutionService.runSingleAgentTask).toHaveBeenCalledWith(expect.objectContaining({
      agentId: '507f1f77bcf86cd799439011',
      query: expect.stringContaining('Current Playbook ID: playbook-1'),
      conversationId: 'conversation-1',
      correlationId: 'playbook-assistant:correlation-1',
    }));
  });

  it('authorizes read access before returning server-owned history', async () => {
    const { service, accessService, historyService } = createService();

    await expect(service.listHistory('playbook-1', 'user-1')).resolves.toEqual({ conversationId: null, messages: [] });
    expect(accessService.findAccessibleFlow).toHaveBeenCalledWith('playbook-1', 'user-1', 'read');
    expect(historyService.list).toHaveBeenCalledWith('user-1', 'playbook-1', undefined);
  });

  it('accepts an operation id only from a completed construction tool result and validates ownership', async () => {
    const { service, constructionService } = createService({
      taskResult: {
        text: 'I started the requested update.',
        toolResults: [{
          name: 'playbook-mcp_start_playbook_construction',
          status: 'completed',
          result: { result: { operationId: 'operation-1' } },
        }],
      },
    });

    const result = await service.runTurn('playbook-1', 'user-1', {
      message: 'Add a review task.',
      expectedDefinitionRevision: 7,
    });

    expect(constructionService.getStatus).toHaveBeenCalledWith('playbook-1', 'user-1', 'operation-1');
    expect(result.operation).toEqual(expect.objectContaining({ operationId: 'operation-1', playbookId: 'playbook-1' }));
  });

  it('rejects multiple construction mutations in one assistant turn', async () => {
    const { service } = createService({
      taskResult: {
        text: 'Started two operations.',
        toolResults: [
          { name: 'playbook-mcp_start_playbook_construction', status: 'completed', result: { operationId: 'operation-1' } },
          { name: 'playbook-mcp_start_workflow_optimization', status: 'completed', result: { operationId: 'operation-2' } },
        ],
      },
    });

    await expect(service.runTurn('playbook-1', 'user-1', {
      message: 'Rewrite everything twice.',
      expectedDefinitionRevision: 7,
    })).rejects.toThrow('more than one construction operation');
  });

  it('requires the server-issued conversation when continuing clarification', async () => {
    const { service, requestService, taskExecutionService } = createService();

    await expect(service.runTurn('playbook-1', 'user-1', {
      message: 'region: France',
      expectedDefinitionRevision: 7,
      continuationId: 'continuation-1',
      answers: [{ questionId: 'region', choice: 'France' }],
    })).rejects.toThrow('requires its conversation identifier');
    expect(requestService.getContinuationForUser).not.toHaveBeenCalled();
    expect(taskExecutionService.runSingleAgentTask).not.toHaveBeenCalled();
  });

  it('releases a newly claimed mutation if construction startup fails', async () => {
    const { service, constructionService, requestService } = createService();
    constructionService.start.mockRejectedValueOnce(new Error('construction unavailable'));

    await expect(service.startBoundConstruction('request-1', {
      ownerId: 'user-1',
      tenantId: 'default',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, 'context-1')).rejects.toThrow('construction unavailable');
    const operationId = constructionService.start.mock.calls[0][3].operationId;
    expect(requestService.releaseMutation).toHaveBeenCalledWith('request-1', operationId);
  });

  it('does not allow existing-Playbook construction before assessment is ready', async () => {
    const { service, constructionService, requestService } = createService();
    requestService.getBound.mockResolvedValueOnce({
      requestId: 'request-1',
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      expectedDefinitionRevision: 7,
      operationKind: 'existing_construction',
      status: 'processing',
      originalText: 'Add scoring',
      attachmentIds: [],
      contextId: 'context-1',
    });

    await expect(service.startBoundConstruction('request-1', {
      ownerId: 'user-1',
      tenantId: 'default',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, 'context-1')).rejects.toThrow('not ready for construction');
    expect(requestService.claimMutation).not.toHaveBeenCalled();
    expect(constructionService.start).not.toHaveBeenCalled();
  });

  it('removes only its unchanged generated draft and resets the claim when generation startup fails', async () => {
    const { service, constructionService, flowService, requestService } = createService();
    requestService.getBound.mockResolvedValueOnce({
      requestId: 'request-1',
      ownerId: 'user-1',
      operationKind: 'generation',
      originalText: 'Build a lead scoring workflow',
    });
    constructionService.start.mockRejectedValueOnce(new Error('construction unavailable'));

    await expect(service.startGeneration('request-1', {
      ownerId: 'user-1',
      tenantId: 'default',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, {})).rejects.toThrow('construction unavailable');

    const operationId = flowService.create.mock.calls[0][2].assistantOperationId;
    expect(flowService.removeAssistantDraftIfUnchanged).toHaveBeenCalledWith(
      'user-1',
      'generated-playbook-1',
      operationId,
      0,
    );
    expect(requestService.resetMutation).toHaveBeenCalledWith('request-1', operationId);
  });

  it('rejects duplicate clarification answers before changing durable state', async () => {
    const { service, requestService, intentService } = createService();

    await expect(service.continueClarification('continuation-1', {
      ownerId: 'user-1',
      tenantId: 'default',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, {
      answers: [
        { questionId: 'region', choice: 'France' },
        { questionId: 'region', choice: 'Germany' },
      ],
    })).rejects.toThrow('duplicate answers');
    expect(requestService.claimContinuation).not.toHaveBeenCalled();
    expect(intentService.assessDesign).not.toHaveBeenCalled();
  });

  it('rejects an empty answer to a required clarification question', async () => {
    const { service, requestService } = createService();

    await expect(service.continueClarification('continuation-1', {
      ownerId: 'user-1',
      tenantId: 'default',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, {
      answers: [{ questionId: 'region', text: '   ' }],
    })).rejects.toThrow('required clarification answer is missing');
    expect(requestService.claimContinuation).not.toHaveBeenCalled();
  });

  it('compensates a failed generated draft and starts a fresh generation operation on retry', async () => {
    const { service, constructionService, flowService, requestService } = createService();
    requestService.getBound.mockResolvedValue({
      requestId: 'request-1',
      ownerId: 'user-1',
      operationKind: 'generation',
      originalText: 'Build lead scoring',
    });
    requestService.claimMutation
      .mockResolvedValueOnce('failed-operation')
      .mockImplementationOnce(async (_requestId: string, operationId: string) => operationId);
    flowService.findByAssistantOperationId.mockResolvedValueOnce({ id: 'failed-playbook' });
    constructionService.getStatus.mockResolvedValueOnce({
      operationId: 'failed-operation',
      playbookId: 'failed-playbook',
      baseDefinitionRevision: 0,
      status: 'failed',
      lastSequence: 3,
    });
    constructionService.start.mockImplementationOnce(async (playbookId: string, _ownerId: string, _dto: unknown, options: { operationId: string }) => ({
      operationId: options.operationId,
      constructionId: options.operationId,
      playbookId,
      baseDefinitionRevision: 0,
    }));

    const result = await service.startGeneration('request-1', {
      ownerId: 'user-1',
      tenantId: 'default',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, {});

    expect(flowService.removeAssistantDraftIfUnchanged).toHaveBeenCalledWith(
      'user-1',
      'failed-playbook',
      'failed-operation',
      0,
    );
    expect(requestService.resetMutation).toHaveBeenCalledWith('request-1', 'failed-operation');
    expect(constructionService.start).toHaveBeenCalledTimes(1);
    expect(result.playbookId).toBe('generated-playbook-1');
  });

  it('preserves a modified generated draft and its claim instead of creating a duplicate on retry', async () => {
    const { service, constructionService, flowService, requestService } = createService();
    requestService.getBound.mockResolvedValue({
      requestId: 'request-1',
      ownerId: 'user-1',
      operationKind: 'generation',
      originalText: 'Build lead scoring',
    });
    requestService.claimMutation.mockResolvedValueOnce('failed-operation');
    flowService.findByAssistantOperationId.mockResolvedValueOnce({ id: 'modified-playbook' });
    flowService.removeAssistantDraftIfUnchanged.mockResolvedValueOnce(false);
    constructionService.getStatus.mockResolvedValueOnce({
      operationId: 'failed-operation',
      playbookId: 'modified-playbook',
      baseDefinitionRevision: 0,
      status: 'failed',
      lastSequence: 3,
    });

    await expect(service.startGeneration('request-1', {
      ownerId: 'user-1',
      tenantId: 'default',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, {})).rejects.toThrow('changed and cannot be replaced');
    expect(requestService.resetMutation).not.toHaveBeenCalled();
    expect(flowService.create).not.toHaveBeenCalled();
  });
});
