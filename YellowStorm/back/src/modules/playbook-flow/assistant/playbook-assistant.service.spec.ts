import { newObjectId } from '@common/postgres';
import { PlaybookAssistantService } from './playbook-assistant.service';

describe('PlaybookAssistantService.runTurn', () => {
  const createService = (overrides: {
    constructionStatus?: Record<string, unknown>;
    assessment?: Record<string, unknown>;
    platformCopilotEnabled?: boolean;
  } = {}) => {
    const accessService = { findAccessibleFlow: jest.fn().mockResolvedValue({ definitionRevision: 7 }) };
    const constructionService = {
      start: jest.fn().mockResolvedValue({
        constructionId: 'operation-1',
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
    const agentService = { findActivePlatformCopilotAgentId: jest.fn().mockResolvedValue('507f1f77bcf86cd799439011') };
    const requestService = {
      claimTurn: jest.fn().mockResolvedValue({
        replay: false,
        request: {
          requestId: 'request-1',
          conversationId: 'conversation-1',
          correlationId: 'playbook-assistant:correlation-1',
          agentId: '507f1f77bcf86cd799439011',
          contextId: 'context-1',
          ownerId: 'user-1',
          playbookId: 'playbook-1',
          expectedDefinitionRevision: 7,
          operationKind: 'existing_construction',
          status: 'processing',
          originalText: 'request',
          answers: [],
          mutationOperationId: null,
        },
      }),
      claimGenerationForTurn: jest.fn().mockResolvedValue({
        requestId: 'generation-request-1',
        ownerId: 'user-1',
        operationKind: 'generation',
        status: 'processing',
        originalText: 'Build lead generation',
        requestedName: 'Lead generation',
        answers: [],
        mutationOperationId: null,
      }),
      claimCurrentTurnModification: jest.fn().mockResolvedValue({
        requestId: 'request-1',
        status: 'processing',
        playbookId: 'playbook-1',
        expectedDefinitionRevision: 7,
        contextId: 'context-1',
      }),
      rebindCorrelationForContinuation: jest.fn().mockResolvedValue(undefined),
      getContinuationForUser: jest.fn().mockResolvedValue({
        requestId: 'request-1',
        conversationId: 'conversation-1',
        correlationId: 'playbook-assistant:correlation-1',
        agentId: '507f1f77bcf86cd799439011',
        contextId: 'context-1',
        ownerId: 'user-1',
        playbookId: 'playbook-1',
        expectedDefinitionRevision: 7,
        operationKind: 'existing_construction',
        status: 'awaiting_clarification',
        originalText: 'Add export',
        assessment: { status: 'needs_clarification', questions: [{ id: 'region', required: true }] },
        answers: [],
        attachmentIds: [],
      }),
      getByContinuation: jest.fn().mockResolvedValue({
        requestId: 'request-1',
        ownerId: 'user-1',
        playbookId: 'playbook-1',
        expectedDefinitionRevision: 7,
        operationKind: 'existing_construction',
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
        assessment: { status: 'ready_to_construct', detectedIntent: 'Add scoring export' },
        answers: [{ questionId: 'source', choice: 'Iterator results' }],
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
      saveAssessment: jest.fn().mockResolvedValue({ continuationId: null }),
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
      findOneBase: jest.fn().mockResolvedValue({ id: 'playbook-1', name: 'Lead qualification' }),
    };
    const executionService = { start: jest.fn().mockResolvedValue({ id: 'execution-1' }) };
    const defaultAssessment = overrides.assessment ?? {
      status: 'ready_for_review',
      detectedIntent: 'Add a review task',
      brief: { goal: 'Review', trigger: 'Existing flow', datasources: [], steps: ['Review'], outputs: [], hitlRules: [] },
      assumptions: [],
      riskFlags: [],
    };
    const intentService = {
      assessDesign: jest.fn().mockResolvedValue(defaultAssessment),
      assessNewDesign: jest.fn().mockResolvedValue(defaultAssessment),
    };
    const conversationService = { getConversationDocument: jest.fn().mockResolvedValue({
      createdBy: 'user-1', runtimePurpose: 'platform_copilot', pinnedAgentId: 'agent-1',
    }) };
    const messageService = { getMessageDocument: jest.fn()
      .mockResolvedValueOnce({
        conversationId: 'conversation-1', conversationType: 'ai', senderId: 'user-1', questionMessageId: 'question-1',
      })
      .mockResolvedValueOnce({
        conversationId: 'conversation-1', conversationType: 'user', senderId: 'user-1', content: 'Build lead generation',
      }) };
    const featureVisibility = {
      isEnabled: jest.fn().mockReturnValue(true),
      getVisibility: jest.fn().mockResolvedValue({ platformCopilot: overrides.platformCopilotEnabled ?? true }),
    };
    const workspaceDocumentService = { findByIds: jest.fn().mockResolvedValue([]) };
    const workspaceShareService = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const playbookHandoffService = { consume: jest.fn().mockResolvedValue(undefined) };
    const service = new PlaybookAssistantService(
      {} as any,
      {} as any,
      accessService as any,
      constructionService as any,
      {} as any,
      flowService as any,
      executionService as any,
      {} as any,
      agentService as any,
      requestService as any,
      historyService as any,
      intentService as any,
      attachmentService as any,
      conversationService as any,
      messageService as any,
      featureVisibility as any,
      workspaceDocumentService as any,
      workspaceShareService as any,
      playbookHandoffService as any,
    );
    return { service, accessService, constructionService, flowService, executionService, agentService, requestService, historyService, intentService, attachmentService, conversationService, messageService, featureVisibility, workspaceDocumentService, workspaceShareService, playbookHandoffService };
  };

  it('returns a focused canvas handoff when it starts an execution', async () => {
    const { service, executionService } = createService();

    await expect(service.startExecution('playbook-1', 'user-1', {
      inputContext: { source: 'Yellowmind' },
    })).resolves.toEqual({
      executionId: 'execution-1',
      playbookName: 'Lead qualification',
      uiTarget: {
        surface: 'playbook.execution.details',
        params: { playbookId: 'playbook-1', executionId: 'execution-1', playbookName: 'Lead qualification' },
        effects: [{ type: 'focusExecutionStatus' }],
      },
    });
    expect(executionService.start).toHaveBeenCalledWith(
      'playbook-1',
      'user-1',
      { source: 'Yellowmind' },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('hands the execution record id over to the execution handoff', async () => {
    const { service, executionService, flowService } = createService();
    const executionId = newObjectId();
    executionService.start.mockResolvedValueOnce({ id: ` ${executionId} ` });
    // The run started: a playbook whose name cannot be read only leaves the button unnamed.
    flowService.findOneBase.mockRejectedValueOnce(new Error('gone'));

    await expect(service.startExecution('playbook-1', 'user-1', {})).resolves.toEqual({
      executionId,
      uiTarget: {
        surface: 'playbook.execution.details',
        params: { playbookId: 'playbook-1', executionId },
        effects: [{ type: 'focusExecutionStatus' }],
      },
    });
  });

  it('rejects unsupported execution identifier shapes', async () => {
    const { service, executionService } = createService();
    executionService.start.mockResolvedValueOnce({ id: { toString: () => 'not-an-object-id' } });

    await expect(service.startExecution('playbook-1', 'user-1', {}))
      .rejects.toThrow('Execution identifier is unavailable');
  });

  it('routes a design turn directly through assessment and construction', async () => {
    const { service, intentService, constructionService } = createService();

    await expect(service.runTurn('playbook-1', 'user-1', {
      message: 'Add a review task',
      expectedDefinitionRevision: 7,
      selectedTaskId: 'task-1',
    })).resolves.toEqual({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      answer: 'The requested Playbook construction is ready in the canvas.',
      assessment: expect.objectContaining({ status: 'ready_for_review' }),
      operation: expect.objectContaining({ operationId: 'operation-1' }),
    });
    expect(intentService.assessDesign).toHaveBeenCalledTimes(1);
    expect(constructionService.start).toHaveBeenCalledTimes(1);
  });

  it('rejects a design turn when Platform Copilot visibility is disabled', async () => {
    const { service, accessService, agentService } = createService({ platformCopilotEnabled: false });

    await expect(service.runTurn('playbook-1', 'user-1', {
      message: 'Add a review task',
      expectedDefinitionRevision: 7,
    })).rejects.toThrow('Platform Copilot is disabled');
    expect(accessService.findAccessibleFlow).not.toHaveBeenCalled();
    expect(agentService.findActivePlatformCopilotAgentId).not.toHaveBeenCalled();
  });

  it('authorizes read access before returning server-owned history', async () => {
    const { service, accessService, historyService } = createService();

    await expect(service.listHistory('playbook-1', 'user-1')).resolves.toEqual({ conversationId: null, messages: [] });
    expect(accessService.findAccessibleFlow).toHaveBeenCalledWith('playbook-1', 'user-1', 'read');
    expect(historyService.list).toHaveBeenCalledWith('user-1', 'playbook-1', undefined);
  });

  it('returns clarification without starting construction', async () => {
    const { service, constructionService } = createService({
      assessment: {
        status: 'needs_clarification',
        detectedIntent: 'Add export',
        questions: [{ id: 'source', question: 'Which source?', reason: 'Required', category: 'datasource', required: true, choices: ['Results'] }],
        missingRequirements: ['source'],
        riskFlags: [],
      },
    });

    const result = await service.runTurn('playbook-1', 'user-1', {
      message: 'Add an export.',
      expectedDefinitionRevision: 7,
    });

    expect(result.assessment).toEqual(expect.objectContaining({ status: 'needs_clarification' }));
    expect(result.operation).toBeNull();
    expect(constructionService.start).not.toHaveBeenCalled();
  });

  it('requires the server-issued conversation when continuing clarification', async () => {
    const { service, requestService, intentService } = createService();

    await expect(service.runTurn('playbook-1', 'user-1', {
      message: 'region: France',
      expectedDefinitionRevision: 7,
      continuationId: 'continuation-1',
      answers: [{ questionId: 'region', choice: 'France' }],
    })).rejects.toThrow('requires its conversation identifier');
    expect(requestService.getContinuationForUser).not.toHaveBeenCalled();
    expect(intentService.assessDesign).not.toHaveBeenCalled();
  });

  it('continues typed clarification without a second assessment call', async () => {
    const { service, intentService, requestService, constructionService } = createService();

    const result = await service.runTurn('playbook-1', 'user-1', {
      message: 'France',
      expectedDefinitionRevision: 7,
      conversationId: 'conversation-1',
      continuationId: 'continuation-1',
      answers: [{ questionId: 'region', choice: 'France' }],
    });

    expect(intentService.assessDesign).not.toHaveBeenCalled();
    expect(requestService.claimContinuation).toHaveBeenCalledWith(expect.objectContaining({
      answers: [{ questionId: 'region', choice: 'France' }],
      assessment: expect.objectContaining({ status: 'ready_to_construct' }),
    }));
    expect(constructionService.start).toHaveBeenCalledTimes(1);
    expect(result.operation).toEqual(expect.objectContaining({ operationId: 'operation-1' }));
  });

  it('passes the persisted assessment and typed answers into construction', async () => {
    const { service, constructionService } = createService();

    await service.startBoundConstruction('request-1', {
      ownerId: 'user-1',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, 'context-1');

    const constructionIntent = constructionService.start.mock.calls[0][2].intent;
    expect(constructionIntent).toContain('Add scoring export');
    expect(constructionIntent).toContain('Iterator results');
    expect(constructionIntent).toContain('Treat the resolved design context as binding');
  });

  it('releases a newly claimed mutation if construction startup fails', async () => {
    const { service, constructionService, requestService } = createService();
    constructionService.start.mockRejectedValueOnce(new Error('construction unavailable'));

    await expect(service.startBoundConstruction('request-1', {
      ownerId: 'user-1',
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
      status: 'ready',
      originalText: 'Build a lead scoring workflow',
      answers: [],
    });
    constructionService.start.mockRejectedValueOnce(new Error('construction unavailable'));

    await expect(service.startGeneration('request-1', {
      ownerId: 'user-1',
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

  it('creates a bound generation request from the canonical platform conversation turn', async () => {
    const { service, requestService, flowService } = createService();
    const generationRequest = {
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation' as const,
      status: 'ready' as const, originalText: 'Build lead generation', requestedName: 'Lead generation',
      assessment: { status: 'ready_to_construct' }, answers: [], mutationOperationId: null,
    };
    requestService.claimGenerationForTurn.mockResolvedValueOnce({ ...generationRequest, status: 'processing' });
    requestService.getBound.mockResolvedValue(generationRequest);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    };

    await expect(service.startCurrentTurnGeneration(actor, { name: 'Lead generation' }))
      .resolves.toEqual(expect.objectContaining({ status: 'planning' }));
    expect(requestService.claimGenerationForTurn).toHaveBeenCalledWith({
      actor,
      text: 'Build lead generation',
      requestedName: 'Lead generation',
    });
    expect(flowService.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
      name: 'Lead generation',
      description: 'Build lead generation',
    }), expect.any(Object));
  });

  it('returns generation clarification without creating a draft', async () => {
    const { service, requestService, flowService, constructionService } = createService({
      assessment: {
        status: 'needs_clarification',
        detectedIntent: 'Build lead generation',
        questions: [{ id: 'source', question: 'Which source?', required: true }],
      },
    });
    const generationRequest = {
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation' as const,
      status: 'processing' as const, originalText: 'Build lead generation', requestedName: 'Lead generation',
      answers: [], mutationOperationId: null,
    };
    requestService.claimGenerationForTurn.mockResolvedValueOnce(generationRequest);
    requestService.getBound.mockResolvedValueOnce(generationRequest);
    requestService.saveAssessment.mockResolvedValueOnce({ continuationId: 'continuation-1' });

    const result = await service.startCurrentTurnGeneration({
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    }, { name: 'Lead generation' });

    expect(result).toEqual(expect.objectContaining({
      status: 'needs_clarification',
      continuationId: 'continuation-1',
      questions: [expect.objectContaining({ id: 'source' })],
    }));
    expect(result).not.toHaveProperty('requestId');
    expect(result).not.toHaveProperty('assessmentId');
    expect(flowService.create).not.toHaveBeenCalled();
    expect(constructionService.start).not.toHaveBeenCalled();
  });

  it('continues generation clarification and preserves its original name and resource answer', async () => {
    const { service, requestService, flowService, constructionService } = createService();
    const workspaceId = '507f1f77bcf86cd799439011';
    requestService.getByContinuation.mockResolvedValueOnce({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'awaiting_clarification', originalText: 'Build lead generation', requestedName: 'Lead generation',
      expectedDefinitionRevision: null, playbookId: null,
      assessment: { status: 'needs_clarification', questions: [{ id: 'source', required: true, resourceSelector: 'workspace_or_document' }] },
      answers: [], attachmentIds: [],
    });
    requestService.getBound.mockResolvedValue({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'ready', originalText: 'Build lead generation', requestedName: 'Lead generation',
      assessment: { status: 'ready_to_construct' },
      answers: [{ questionId: 'source', resource: { kind: 'workspace', id: workspaceId } }],
      mutationOperationId: null,
    });

    await expect(service.startCurrentTurnGeneration({
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-2',
    }, {
      continuationId: 'continuation-1',
      answers: [{ questionId: 'source', resource: { kind: 'workspace', id: workspaceId } }],
    })).resolves.toEqual(expect.objectContaining({ status: 'planning' }));

    expect(flowService.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
      name: 'Lead generation',
    }), expect.any(Object));
    expect(constructionService.start.mock.calls[0][2].intent).toContain(workspaceId);
  });

  it('creates the new playbook when its answers come through the generic clarification tool or a construction call', async () => {
    const { service, requestService, flowService } = createService();
    const actor = { ownerId: 'user-1', agentId: 'agent-1', conversationId: 'conversation-1', correlationId: 'ai-message-2' };
    requestService.getByContinuation.mockResolvedValueOnce({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'awaiting_clarification', originalText: 'Create a leadgen pipeline', requestedName: 'Lead generation',
      expectedDefinitionRevision: null, playbookId: null,
      assessment: { status: 'needs_clarification', questions: [{ id: 'trigger', required: true }] },
      answers: [], attachmentIds: [],
    });
    requestService.getBound.mockResolvedValue({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'ready', originalText: 'Create a leadgen pipeline', requestedName: 'Lead generation',
      assessment: { status: 'ready_to_construct' }, answers: [{ questionId: 'trigger', choice: 'Manual' }],
      mutationOperationId: null,
    });

    await expect(service.continueClarificationAndStart('continuation-1', actor, { answers: [{ questionId: 'trigger', choice: 'Manual' }] }))
      .resolves.toEqual(expect.objectContaining({ status: 'planning', playbookId: 'playbook-1', requestId: 'generation-request-1' }));
    expect(flowService.create).toHaveBeenCalledTimes(1);

    flowService.create.mockClear();
    await expect(service.startBoundConstruction('generation-request-1', actor))
      .resolves.toEqual(expect.objectContaining({ status: 'planning', playbookId: 'playbook-1' }));
    expect(flowService.create).toHaveBeenCalledTimes(1);
  });

  it('shows the sources card for a question that asks for a source, with the choices by name only', async () => {
    const { service, requestService } = createService();
    const waiting = {
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation' as const,
      status: 'awaiting_clarification' as const, originalText: 'Screen CVs', requestedName: 'CV screening',
      continuationId: 'continuation-1', answers: [], mutationOperationId: null,
      assessment: {
        status: 'needs_clarification',
        questions: [{ id: 'source', question: 'Which CVs?', required: true, resourceSelector: 'workspace_or_document' }],
        resourcePicks: { source: { resources: [{ kind: 'workspace', id: '507f1f77bcf86cd799439011', workspaceId: '507f1f77bcf86cd799439011', workspaceName: 'Recruiting', label: 'Recruiting' }] } },
      },
    };
    requestService.claimGenerationForTurn.mockResolvedValueOnce(waiting);

    const result = await service.startCurrentTurnGeneration({
      ownerId: 'user-1', agentId: 'agent-1', conversationId: 'conversation-1', correlationId: 'ai-message-1',
    }, {});

    expect(result).toEqual(expect.objectContaining({
      status: 'needs_clarification',
      uiTarget: { surface: 'playbook.sources', params: { continuationId: 'continuation-1', playbookName: 'CV screening' } },
      chosenSources: [{ questionId: 'source', chosen: ['Recruiting (workspace)'] }],
    }));
    expect(JSON.stringify(result)).not.toContain('507f1f77bcf86cd799439011');
  });

  it('joins the sources the user chose, binds them in the construction and gives the new playbook their workspaces', async () => {
    const { service, requestService, flowService, constructionService } = createService();
    const workspaceId = '507f1f77bcf86cd799439011';
    const documentWorkspaceId = '507f1f77bcf86cd799439012';
    const picked = [
      { kind: 'workspace', id: workspaceId, workspaceId, workspaceName: 'Recruiting', label: 'Recruiting' },
      { kind: 'document', id: '507f1f77bcf86cd799439013', workspaceId: documentWorkspaceId, workspaceName: 'HR', label: 'Grid [2024].xlsx' },
    ];
    const questions = [
      { id: 'source', question: 'Which CVs: all?', required: true, resourceSelector: 'workspace_or_document' },
      { id: 'output', question: 'What output?', required: true },
    ];
    requestService.getByContinuation.mockResolvedValueOnce({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'awaiting_clarification', originalText: 'Screen CVs', requestedName: 'CV screening',
      expectedDefinitionRevision: null, playbookId: null,
      assessment: { status: 'needs_clarification', questions, resourcePicks: { source: { resources: picked } } },
      answers: [], attachmentIds: [],
    });
    requestService.getBound.mockImplementation(async () => ({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'ready', originalText: 'Screen CVs', requestedName: 'CV screening',
      assessment: { status: 'ready_to_construct', questions },
      answers: requestService.claimContinuation.mock.calls[0]?.[0].answers ?? [],
      mutationOperationId: null,
    }));

    await service.startCurrentTurnGeneration({
      ownerId: 'user-1', agentId: 'agent-1', conversationId: 'conversation-1', correlationId: 'ai-message-2',
    }, {
      continuationId: 'continuation-1',
      // The assistant's own words for the source are replaced by what the user chose.
      answers: [{ questionId: 'source', text: 'the recruiting workspace' }, { questionId: 'output', choice: 'Shortlist' }],
    });

    const claimed = requestService.claimContinuation.mock.calls[0][0];
    expect(claimed.answers).toEqual([
      { questionId: 'output', choice: 'Shortlist' },
      { questionId: 'source', resources: picked },
    ]);
    expect(claimed.assessment).not.toHaveProperty('resourcePicks');
    expect(flowService.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
      workspaces: [workspaceId, documentWorkspaceId],
    }), expect.any(Object));
    const intent: string = constructionService.start.mock.calls[0][2].intent;
    expect(intent).toContain(`\n\nClarifications:\nWhich CVs - all?: Recruiting [kind=workspace, id=${workspaceId}, workspaceId=${workspaceId}, workspaceName=Recruiting]`);
    expect(intent).toContain('Which CVs - all?: Grid (2024).xlsx [kind=document');
  });

  it('asks for the sources card when a required source was neither chosen nor skipped', async () => {
    const { service, requestService } = createService();
    requestService.getByContinuation.mockResolvedValueOnce({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'awaiting_clarification', originalText: 'Screen CVs', expectedDefinitionRevision: null, playbookId: null,
      assessment: { status: 'needs_clarification', questions: [{ id: 'source', question: 'Which CVs?', required: true, resourceSelector: 'workspace_or_document' }] },
      answers: [], attachmentIds: [],
    });

    await expect(service.startCurrentTurnGeneration({
      ownerId: 'user-1', agentId: 'agent-1', conversationId: 'conversation-1', correlationId: 'ai-message-2',
    }, { continuationId: 'continuation-1', answers: [] })).rejects.toThrow(/"Which CVs\?".*sources card/);
    expect(requestService.claimContinuation).not.toHaveBeenCalled();
  });

  it('builds with a run-time input when the user skipped a source', async () => {
    const { service, requestService } = createService();
    requestService.getByContinuation.mockResolvedValueOnce({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'awaiting_clarification', originalText: 'Screen CVs', expectedDefinitionRevision: null, playbookId: null,
      assessment: {
        status: 'needs_clarification',
        questions: [{ id: 'source', question: 'Which CVs?', required: true, resourceSelector: 'workspace_or_document' }],
        resourcePicks: { source: { skipped: true } },
      },
      answers: [], attachmentIds: [],
    });

    await service.continueClarification('continuation-1', {
      ownerId: 'user-1', agentId: 'agent-1', conversationId: 'conversation-1', correlationId: 'ai-message-2',
    }, { answers: [] });

    expect(requestService.claimContinuation.mock.calls[0][0].answers).toEqual([
      { questionId: 'source', text: expect.stringContaining('run-time input') },
    ]);
  });

  it('rejects a generation clarification resource outside the acting user access', async () => {
    const { service, requestService, workspaceShareService } = createService();
    const workspaceId = '507f1f77bcf86cd799439011';
    requestService.getByContinuation.mockResolvedValueOnce({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'awaiting_clarification', originalText: 'Build lead generation',
      assessment: { questions: [{ id: 'source', required: true, resourceSelector: 'workspace_or_document' }] },
      answers: [],
    });
    workspaceShareService.assertUserHasAccess.mockRejectedValueOnce(new Error('forbidden workspace'));

    await expect(service.startCurrentTurnGeneration({
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-2',
    }, {
      continuationId: 'continuation-1',
      answers: [{ questionId: 'source', resource: { kind: 'workspace', id: workspaceId } }],
    })).rejects.toThrow('forbidden workspace');

    expect(requestService.claimContinuation).not.toHaveBeenCalled();
  });

  it('rejects a document answer for a destination-workspace question', async () => {
    const { service, requestService, workspaceDocumentService } = createService();
    requestService.getByContinuation.mockResolvedValueOnce({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'awaiting_clarification', originalText: 'Build lead generation',
      assessment: { questions: [{ id: 'destination', required: true, resourceSelector: 'destination_workspace' }] },
      answers: [],
    });

    await expect(service.startCurrentTurnGeneration({
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-2',
    }, {
      continuationId: 'continuation-1',
      answers: [{
        questionId: 'destination',
        resource: { kind: 'document', id: '507f1f77bcf86cd799439011' },
      }],
    })).rejects.toThrow('does not match the active question');

    expect(workspaceDocumentService.findByIds).not.toHaveBeenCalled();
    expect(requestService.claimContinuation).not.toHaveBeenCalled();
  });

  it('preserves authorized document workspace metadata through generation construction', async () => {
    const { service, requestService, constructionService, workspaceDocumentService } = createService();
    const documentId = '507f1f77bcf86cd799439011';
    const workspaceId = '507f191e810c19729de860ea';
    requestService.getByContinuation.mockResolvedValueOnce({
      requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
      status: 'awaiting_clarification', originalText: 'Build invoice processing',
      assessment: { questions: [{ id: 'source', required: true, resourceSelector: 'workspace_or_document' }] },
      answers: [],
    });
    workspaceDocumentService.findByIds.mockResolvedValueOnce([{
      id: documentId,
      workspaceId,
      originalName: 'Invoices.pdf',
      mimeType: 'application/pdf',
      path: '/Finance/Invoices.pdf',
      isFolder: false,
    }]);
    requestService.claimContinuation.mockImplementationOnce(async (input: { answers: Record<string, unknown>[] }) => {
      requestService.getBound.mockResolvedValue({
        requestId: 'generation-request-1', ownerId: 'user-1', operationKind: 'generation',
        status: 'ready', originalText: 'Build invoice processing', assessment: { status: 'ready_to_construct' },
        answers: input.answers, mutationOperationId: null,
      });
    });

    await service.startCurrentTurnGeneration({
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-2',
    }, {
      continuationId: 'continuation-1',
      answers: [{ questionId: 'source', resource: { kind: 'document', id: documentId } }],
    });

    const persistedAnswers = requestService.claimContinuation.mock.calls[0][0].answers;
    expect(persistedAnswers).toEqual([expect.objectContaining({
      resource: expect.objectContaining({
        kind: 'document',
        id: documentId,
        documentId,
        workspaceId,
      }),
    })]);
    expect(constructionService.start.mock.calls[0][2].intent).toContain(`"workspaceId":"${workspaceId}"`);
    expect(constructionService.start.mock.calls[0][2].intent).toContain(`"documentId":"${documentId}"`);
  });

  it('rejects a platform generation turn whose pinned agent does not match', async () => {
    const { service, conversationService, requestService } = createService();
    conversationService.getConversationDocument.mockResolvedValueOnce({
      createdBy: 'user-1', runtimePurpose: 'platform_copilot', pinnedAgentId: 'other-agent',
    });

    await expect(service.startCurrentTurnGeneration({
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    }, {})).rejects.toThrow('conversation binding does not match');
    expect(requestService.claimGenerationForTurn).not.toHaveBeenCalled();
  });

  it('modifies an existing Playbook from the current platform turn through assessment and construction', async () => {
    const { service, requestService, intentService, constructionService } = createService();
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    };

    await expect(service.runCurrentTurnModification('playbook-1', actor, {}))
      .resolves.toEqual(expect.objectContaining({
        requestId: 'request-1',
        status: 'ready',
        operation: expect.objectContaining({ operationId: 'operation-1' }),
      }));
    expect(requestService.claimCurrentTurnModification).toHaveBeenCalledWith({
      actor,
      playbookId: 'playbook-1',
      expectedDefinitionRevision: 7,
      text: 'Build lead generation',
    });
    expect(intentService.assessDesign).toHaveBeenCalledTimes(1);
    expect(constructionService.start).toHaveBeenCalledTimes(1);
    expect(requestService.complete).toHaveBeenCalledWith('request-1', expect.any(String), 'operation-1');
  });

  it('returns typed clarification from the current turn without constructing', async () => {
    const { service, constructionService, requestService } = createService({
      assessment: {
        status: 'needs_clarification',
        detectedIntent: 'Add export task',
        questions: [{ id: 'source', question: 'Which source?', reason: 'Required', category: 'datasource', required: true, choices: ['Results'] }],
        missingRequirements: ['source'],
        riskFlags: [],
      },
    });
    requestService.saveAssessment.mockResolvedValueOnce({ continuationId: 'continuation-1' });

    const result = await service.runCurrentTurnModification('playbook-1', {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    }, {});

    expect(result.status).toBe('needs_clarification');
    expect(result.continuationId).toBe('continuation-1');
    expect(constructionService.start).not.toHaveBeenCalled();
  });

  it('continues a clarification from a later turn after rebinding its correlation', async () => {
    const { service, requestService, intentService, constructionService } = createService();
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-2',
    };

    await expect(service.runCurrentTurnModification('playbook-1', actor, {
      continuationId: 'continuation-1',
      answers: [{ questionId: 'region', choice: 'France' }],
    })).resolves.toEqual(expect.objectContaining({
      requestId: 'request-1',
      status: 'ready',
    }));
    expect(requestService.rebindCorrelationForContinuation).toHaveBeenCalledWith({
      continuationId: 'continuation-1',
      playbookId: 'playbook-1',
      actor,
    });
    expect(intentService.assessDesign).not.toHaveBeenCalled();
    expect(constructionService.start).toHaveBeenCalledTimes(1);
  });

  it('rejects a platform modification turn whose pinned agent does not match', async () => {
    const { service, conversationService, requestService } = createService();
    conversationService.getConversationDocument.mockResolvedValueOnce({
      createdBy: 'user-1', runtimePurpose: 'platform_copilot', pinnedAgentId: 'other-agent',
    });

    await expect(service.runCurrentTurnModification('playbook-1', {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    }, {})).rejects.toThrow('conversation binding does not match');
    expect(requestService.claimCurrentTurnModification).not.toHaveBeenCalled();
  });

  it('rejects duplicate clarification answers before changing durable state', async () => {
    const { service, requestService, intentService } = createService();

    await expect(service.continueClarification('continuation-1', {
      ownerId: 'user-1',
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

  it('rebinds the clarification correlation before binding a later-turn answer', async () => {
    const { service, requestService } = createService();
    const actor = {
      ownerId: 'user-1',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'ai-message-2',
    };

    await service.continueClarification('continuation-1', actor, {
      answers: [{ questionId: 'region', choice: 'France' }],
    });

    expect(requestService.rebindCorrelationForContinuation).toHaveBeenCalledWith({
      continuationId: 'continuation-1',
      actor,
    });
    expect(requestService.getByContinuation).toHaveBeenCalledWith('continuation-1', actor);
  });

  it('skips missing required answers when the user explicitly skips clarifications', async () => {
    const { service, requestService } = createService();

    const result = await service.continueClarification('continuation-1', {
      ownerId: 'user-1',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, {
      answers: [],
      skip: true,
    });

    expect(result.status).toBe('ready_to_construct');
    expect(result.clarificationsSkipped).toBe(true);
    expect(result.unansweredQuestionIds).toEqual(['region']);
    expect(requestService.claimContinuation).toHaveBeenCalledWith(expect.objectContaining({
      assessment: expect.objectContaining({
        clarificationsSkipped: true,
        unansweredQuestionIds: ['region'],
      }),
    }));
  });

  it('records only unanswered questions when skipping with partial answers', async () => {
    const { service } = createService();

    const result = await service.continueClarification('continuation-1', {
      ownerId: 'user-1',
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, {
      answers: [{ questionId: 'region', choice: 'France' }],
      skip: true,
    });

    expect(result.clarificationsSkipped).toBe(true);
    expect(result.unansweredQuestionIds).toEqual([]);
  });

  it('rejects an empty answer to a required clarification question', async () => {
    const { service, requestService } = createService();

    await expect(service.continueClarification('continuation-1', {
      ownerId: 'user-1',
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
    const requestState = {
      requestId: 'request-1',
      ownerId: 'user-1',
      operationKind: 'generation',
      status: 'ready',
      mutationOperationId: 'failed-operation' as string | null,
      originalText: 'Build lead scoring',
      answers: [],
    };
    requestService.getBound.mockImplementation(async () => ({ ...requestState }));
    requestService.claimMutation
      .mockResolvedValueOnce('failed-operation')
      .mockImplementationOnce(async (_requestId: string, operationId: string) => {
        requestState.mutationOperationId = operationId;
        return operationId;
      });
    requestService.resetMutation.mockImplementationOnce(async () => {
      requestState.mutationOperationId = null;
      requestState.status = 'ready';
      return true;
    });
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
      mutationOperationId: 'failed-operation',
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
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    }, {})).rejects.toThrow('changed and cannot be replaced');
    expect(requestService.resetMutation).not.toHaveBeenCalled();
    expect(flowService.create).not.toHaveBeenCalled();
  });
});
