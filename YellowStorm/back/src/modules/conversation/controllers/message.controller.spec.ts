import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { MessageController } from './message.controller';
import { ConflictException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

describe('MessageController.sendMessage sticky routing', () => {
  const userId = new Types.ObjectId();
  const conversationId = new Types.ObjectId().toString();
  const stickyAgentId = new Types.ObjectId().toString();
  const mentionedAgentId = new Types.ObjectId().toString();

  let messageService: {
    createUserMessage: jest.Mock;
    createAIPlaceholder: jest.Mock;
    createUserMessageWithAiPlaceholder: jest.Mock;
    markStreamFailed: jest.Mock;
    findTurnByRequestId: jest.Mock;
    getMessageDocument: jest.Mock;
    findById: jest.Mock;
    findToolActivityResult: jest.Mock;
    reportFrontendLatency: jest.Mock;
  };
  let streamService: {
    isAvailable: jest.Mock;
    isConversationStreaming: jest.Mock;
    startStream: jest.Mock;
    generateConversationNameAsync: jest.Mock;
  };
  let conversationService: {
    getConversationDocument: jest.Mock;
    updateConversationInternal: jest.Mock;
    replaceTaggedAgentIds: jest.Mock;
    ensureSystemWorkspace: jest.Mock;
    assertPlatformCopilotAgent: jest.Mock;
    resolvePlatformCopilotAgent: jest.Mock;
  };
  let modelsService: { validateModelActive: jest.Mock };
  let teamService: { resolveAgentIds: jest.Mock };
  let requestContext: { getRequestId: jest.Mock };
  let choiceInteractionService: { canonicalize: jest.Mock; canonicalizeMany: jest.Mock };
  let responseReliabilityService: { rerun: jest.Mock };
  let semanticModelService: { resolveChatModel: jest.Mock };
  let conversationArtifactService: { resolveDownloadUrl: jest.Mock; resolveCitationUrl: jest.Mock };
  let playbookHandoffService: { bind: jest.Mock; attachUserMessage: jest.Mock };
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let controller: MessageController;

  const user = {
    _id: userId,
    email: 'user@example.com',
    profile: { firstName: 'Ada', lastName: 'Lovelace' },
    permissions: ['playbook.read'],
  } as any;

  beforeEach(() => {
    const createUserMessageMock = jest.fn().mockResolvedValue({
      id: new Types.ObjectId().toString(),
      agentIds: [],
    });
    const createAIPlaceholderMock = jest.fn().mockResolvedValue({
      id: new Types.ObjectId().toString(),
    });
    messageService = {
      createUserMessage: createUserMessageMock,
      createAIPlaceholder: createAIPlaceholderMock,
      // Compose the merged-turn mock from the two existing mocks so call
      // assertions on either remain meaningful.
      createUserMessageWithAiPlaceholder: jest.fn(
        async (data: { placeholder: Record<string, unknown> }) => {
          const userMessage = await createUserMessageMock(data);
          const aiMessage = await createAIPlaceholderMock({
            ...data.placeholder,
            questionMessageId: userMessage.id,
          });
          return { userMessage, aiMessage };
        },
      ),
      markStreamFailed: jest.fn(),
      findTurnByRequestId: jest.fn().mockResolvedValue(null),
      getMessageDocument: jest.fn(),
      findById: jest.fn(),
      findToolActivityResult: jest.fn(),
      reportFrontendLatency: jest.fn().mockResolvedValue({ id: 'ai-1' }),
    };
    streamService = {
      isAvailable: jest.fn().mockReturnValue(true),
      isConversationStreaming: jest.fn().mockReturnValue(false),
      startStream: jest.fn().mockResolvedValue(undefined),
      generateConversationNameAsync: jest.fn(),
    };
    conversationService = {
      getConversationDocument: jest.fn(),
      updateConversationInternal: jest.fn().mockResolvedValue(undefined),
      replaceTaggedAgentIds: jest.fn().mockResolvedValue(undefined),
      ensureSystemWorkspace: jest.fn().mockResolvedValue(undefined),
      assertPlatformCopilotAgent: jest.fn().mockResolvedValue(stickyAgentId),
      resolvePlatformCopilotAgent: jest.fn().mockResolvedValue(stickyAgentId),
    };
    modelsService = { validateModelActive: jest.fn() };
    teamService = { resolveAgentIds: jest.fn().mockResolvedValue([]) };
    requestContext = { getRequestId: jest.fn().mockReturnValue('req-1') };
    choiceInteractionService = { canonicalize: jest.fn(), canonicalizeMany: jest.fn() };
    responseReliabilityService = { rerun: jest.fn().mockResolvedValue({ messageId: 'ai-1', reliabilityEvaluation: { status: 'pending' } }) };
    semanticModelService = { resolveChatModel: jest.fn().mockResolvedValue({ id: 'model-1', name: 'Contracts' }) };
    conversationArtifactService = { resolveDownloadUrl: jest.fn(), resolveCitationUrl: jest.fn() };
    playbookHandoffService = {
      bind: jest.fn().mockResolvedValue(undefined),
      attachUserMessage: jest.fn().mockResolvedValue(undefined),
    };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    controller = new MessageController(
      messageService as any,
      streamService as any,
      conversationService as any,
      modelsService as any,
      teamService as any,
      requestContext as any,
      logger as any,
      choiceInteractionService as any,
      { resolveRuntime: jest.fn(), assertRuntimeRequestAllowed: jest.fn(), resolveEffectiveAgents: jest.fn() } as any,
      responseReliabilityService as any,
      semanticModelService as any,
      conversationArtifactService as any,
      playbookHandoffService as any,
      { isLatencyInstrumentationEnabledCached: jest.fn().mockReturnValue(true) } as any,
    );
  });

  it('forwards scoped citation URL resolution', async () => {
    conversationArtifactService.resolveCitationUrl.mockResolvedValue({
      url: 'https://storage.example/report', fileName: 'report.pdf', mimeType: 'application/pdf',
    });

    await expect(controller.getCitationUrl({ _id: 'user-1' }, conversationId, 'message-1', {
      source: 'deepsearch', fileName: 'report.pdf',
    })).resolves.toEqual(expect.objectContaining({ fileName: 'report.pdf' }));
    expect(conversationArtifactService.resolveCitationUrl).toHaveBeenCalledWith(
      conversationId, 'message-1', { source: 'deepsearch', fileName: 'report.pdf' }, 'user-1',
    );
  });

  it('forwards on-demand tool result lookups with route identifiers', async () => {
    messageService.findToolActivityResult.mockResolvedValue({ resultJson: '{"ok":true}' });

    await expect(controller.getToolActivityResult(conversationId, 'message-1', 'tool-1'))
      .resolves.toEqual({ resultJson: '{"ok":true}' });
    expect(messageService.findToolActivityResult).toHaveBeenCalledWith(conversationId, 'message-1', 'tool-1');
  });

  it('forces a platform copilot conversation through its pinned agent', async () => {
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      runtimePurpose: 'platform_copilot',
      pinnedAgentId: new Types.ObjectId(stickyAgentId),
      taggedAgentIds: [],
    });

    const playbookHandoffId = randomUUID();
    await controller.sendMessage(user, conversationId, {
      content: 'validate this playbook',
      requestId: 'turn-1',
      playbookHandoffId,
      clientContext: {
        contextVersion: 1,
        route: '/playbooks',
        module: 'playbooks',
        surface: 'playbook.list',
        availableActions: ['search'],
        hasUnsavedChanges: false,
        locale: 'en',
      },
    } as any);

    expect(conversationService.resolvePlatformCopilotAgent).toHaveBeenCalledWith(expect.objectContaining({
      pinnedAgentId: expect.any(Types.ObjectId),
    }));
    expect(messageService.createUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      agentIds: [stickyAgentId],
      requestId: 'turn-1',
      replayContext: expect.objectContaining({ clientContext: expect.objectContaining({ contextVersion: 1 }) }),
    }));
    expect(messageService.createAIPlaceholder).toHaveBeenCalledWith(expect.objectContaining({
      senderId: userId.toString(),
      requestId: 'turn-1',
    }));
    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(), conversationId, expect.any(String),
      expect.objectContaining({
        agentIds: [stickyAgentId],
        clientContext: expect.objectContaining({ contextVersion: 1 }),
        playbookHandoffId,
      }),
      'turn-1', undefined, 'Ada Lovelace', undefined,
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });

  it('rejects client routing overrides for platform copilot conversations', async () => {
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      runtimePurpose: 'platform_copilot',
      pinnedAgentId: new Types.ObjectId(stickyAgentId),
      taggedAgentIds: [],
    });

    await expect(controller.sendMessage(user, conversationId, {
      content: 'override',
      agentIds: [mentionedAgentId],
    } as any)).rejects.toThrow('cannot be overridden');
    expect(messageService.createUserMessage).not.toHaveBeenCalled();
  });

  it('recovers a platform turn whose user message was persisted without an AI placeholder', async () => {
    const userMessageId = new Types.ObjectId().toString();
    const aiMessageId = new Types.ObjectId().toString();
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      runtimePurpose: 'platform_copilot',
      pinnedAgentId: new Types.ObjectId(stickyAgentId),
      taggedAgentIds: [],
    });
    messageService.findTurnByRequestId.mockResolvedValue({
      userMessage: { id: userMessageId, content: 'Create a lead Playbook' },
      requestFingerprint: (controller as any).fingerprintTurn({
        content: 'Create a lead Playbook', requestId: 'turn-recovery',
      }),
    });
    messageService.createAIPlaceholder.mockResolvedValue({ id: aiMessageId });

    await expect(controller.sendMessage(user, conversationId, {
      content: 'Create a lead Playbook', requestId: 'turn-recovery',
    } as any)).resolves.toEqual({
      userMessage: expect.objectContaining({ id: userMessageId }),
      aiMessageId,
    });
    expect(messageService.createUserMessage).not.toHaveBeenCalled();
    expect(messageService.createAIPlaceholder).toHaveBeenCalledWith({
      conversationId,
      questionMessageId: userMessageId,
      senderId: userId.toString(),
      requestId: 'turn-recovery',
    });
    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(), conversationId, aiMessageId,
      expect.objectContaining({ content: 'Create a lead Playbook', agentIds: [stickyAgentId] }),
      'turn-recovery', undefined, 'Ada Lovelace',
      undefined,
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });

  it('restarts an incomplete platform placeholder after a process interruption', async () => {
    const aiMessageId = new Types.ObjectId().toString();
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      runtimePurpose: 'platform_copilot',
      pinnedAgentId: new Types.ObjectId(stickyAgentId),
      taggedAgentIds: [],
    });
    messageService.findTurnByRequestId.mockResolvedValue({
      userMessage: { id: new Types.ObjectId().toString(), content: 'Create a lead Playbook' },
      aiMessageId,
      requestFingerprint: (controller as any).fingerprintTurn({
        content: 'Create a lead Playbook', requestId: 'turn-recovery',
      }),
    });
    messageService.getMessageDocument.mockResolvedValue({ isComplete: false });

    await controller.sendMessage(user, conversationId, {
      content: 'Create a lead Playbook', requestId: 'turn-recovery',
    } as any);

    expect(messageService.createAIPlaceholder).not.toHaveBeenCalled();
    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(), conversationId, aiMessageId,
      expect.objectContaining({ agentIds: [stickyAgentId] }),
      'turn-recovery', undefined, 'Ada Lovelace',
      undefined,
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });

  it('allows a generic platform copilot turn without playbook permission', async () => {
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      runtimePurpose: 'platform_copilot',
      pinnedAgentId: new Types.ObjectId(stickyAgentId),
      taggedAgentIds: [],
    });

    await expect(controller.sendMessage({ ...user, permissions: [] }, conversationId, {
      content: 'What can you help me with?',
    } as any)).resolves.toEqual(expect.objectContaining({ aiMessageId: expect.any(String) }));
    expect(conversationService.resolvePlatformCopilotAgent).toHaveBeenCalled();
    expect(messageService.createUserMessage).toHaveBeenCalled();
  });

  it('mention replaces sticky and streams with mentioned agents', async () => {
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      taggedAgentIds: [new Types.ObjectId(stickyAgentId)],
    });

    await controller.sendMessage(user, conversationId, {
      content: `@Agent ${mentionedAgentId}`,
      agentIds: [mentionedAgentId],
    } as any);

    expect(conversationService.replaceTaggedAgentIds).toHaveBeenCalledWith(
      conversationId,
      [mentionedAgentId],
    );
    expect(messageService.createUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ agentIds: [mentionedAgentId] }),
    );
    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(),
      conversationId,
      expect.any(String),
      expect.objectContaining({ agentIds: [mentionedAgentId] }),
      'req-1',
      undefined,
      'Ada Lovelace',
      undefined,
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });

  it('without mention reuses sticky taggedAgentIds', async () => {
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      taggedAgentIds: [new Types.ObjectId(stickyAgentId)],
    });

    await controller.sendMessage(user, conversationId, {
      content: 'continue please',
    } as any);

    expect(conversationService.replaceTaggedAgentIds).not.toHaveBeenCalled();
    expect(messageService.createUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ agentIds: [stickyAgentId] }),
    );
    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(),
      conversationId,
      expect.any(String),
      expect.objectContaining({ agentIds: [stickyAgentId] }),
      'req-1',
      undefined,
      'Ada Lovelace',
      undefined,
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });

  it('preserves one team without expanding or reusing sticky agents', async () => {
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      taggedAgentIds: [new Types.ObjectId(stickyAgentId)],
    });
    const teamId = new Types.ObjectId().toString();

    await controller.sendMessage(user, conversationId, { content: '@Team', teamIds: [teamId] } as any);

    expect(teamService.resolveAgentIds).not.toHaveBeenCalled();
    expect(conversationService.replaceTaggedAgentIds).not.toHaveBeenCalled();
    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(), conversationId, expect.any(String),
      expect.objectContaining({ teamId, agentIds: [] }),
      'req-1', undefined, 'Ada Lovelace', undefined, expect.any(Object),
    );
    expect(messageService.createUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      replayContext: expect.objectContaining({ teamId, agentIds: [] }),
    }));
  });

  it.each([
    { teamIds: ['team-1', 'team-2'] },
    { teamIds: ['team-1'], agentIds: ['agent-1'] },
  ])('rejects mixed or multiple team routing', async (routing) => {
    conversationService.getConversationDocument.mockResolvedValue({ isFirstMessage: false, taggedAgentIds: [] });
    await expect(controller.sendMessage(user, conversationId, { content: 'invalid', ...routing } as any)).rejects.toThrow();
    expect(messageService.createUserMessage).not.toHaveBeenCalled();
  });

  it('member-only turn skips AI and does not reuse sticky on the message', async () => {
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      taggedAgentIds: [new Types.ObjectId(stickyAgentId)],
    });
    const memberId = new Types.ObjectId().toString();

    await controller.sendMessage(user, conversationId, {
      content: '@member hi',
      memberIds: [memberId],
    } as any);

    expect(conversationService.replaceTaggedAgentIds).not.toHaveBeenCalled();
    expect(messageService.createUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentIds: undefined,
        memberIds: [memberId],
      }),
    );
    expect(messageService.createAIPlaceholder).not.toHaveBeenCalled();
    expect(streamService.startStream).not.toHaveBeenCalled();
  });

  it('returns the assistant placeholder id for reconnect recovery', async () => {
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      taggedAgentIds: [],
    });
    const aiMessageId = new Types.ObjectId().toString();
    messageService.createAIPlaceholder.mockResolvedValue({ id: aiMessageId });

    const result = await controller.sendMessage(user, conversationId, { content: 'hello' } as any);

    expect(result).toEqual(expect.objectContaining({ aiMessageId }));
  });

  it('uses canonical choice content for persistence and agent streaming', async () => {
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      taggedAgentIds: [],
    });
    const canonicalInteraction = {
      type: 'choice', componentId: 'choice-1', questionId: 'q1',
      sourceMessageId: new Types.ObjectId().toString(), selectionMode: 'single',
      selectedOptions: [{ optionId: 'profitability', label: 'Profitability' }],
      displayText: 'Profitability',
    };
    choiceInteractionService.canonicalize.mockResolvedValue({
      content: '{"selectedChoices":[{"submitText":"Analyze profitability","description":"Review margins"}]}',
      taskSummary: 'Profitability',
      interaction: canonicalInteraction,
    });

    await controller.sendMessage(user, conversationId, {
      content: 'browser-controlled content',
      interaction: { type: 'choice' },
    } as any);

    expect(messageService.createUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: '{"selectedChoices":[{"submitText":"Analyze profitability","description":"Review margins"}]}',
      interaction: canonicalInteraction,
      replayContext: expect.objectContaining({
        content: '{"selectedChoices":[{"submitText":"Analyze profitability","description":"Review margins"}]}',
        taskSummary: 'Profitability',
        attachedFileIds: [],
        deepSearchEnabled: false,
        skillIds: [],
      }),
    }));
    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(),
      conversationId,
      expect.any(String),
      expect.objectContaining({
        content: '{"selectedChoices":[{"submitText":"Analyze profitability","description":"Review margins"}]}',
        taskSummary: 'Profitability',
      }),
      'req-1',
      undefined,
      'Ada Lovelace',
      undefined,
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });

  it('canonicalizes multiple choice interactions into one persisted turn', async () => {
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      taggedAgentIds: [],
    });
    choiceInteractionService.canonicalizeMany.mockResolvedValue({
      content: '[{"selectedChoices":[{"submitText":"Use France"}]},{"selectedChoices":[{"submitText":"Use Germany"}]}]',
      taskSummary: 'France, Germany',
      interactions: [
        { type: 'choice', componentId: 'choice-1', questionId: 'region', sourceMessageId: new Types.ObjectId().toString(), selectionMode: 'single', selectedOptions: [{ optionId: 'france', label: 'France' }] },
        { type: 'choice', componentId: 'choice-2', questionId: 'scope', sourceMessageId: new Types.ObjectId().toString(), selectionMode: 'single', selectedOptions: [{ optionId: 'germany', label: 'Germany' }] },
      ],
    });

    await controller.sendMessage(user, conversationId, {
      content: 'browser-controlled content',
      interactions: [
        { type: 'choice', componentId: 'choice-1', questionId: 'region', sourceMessageId: new Types.ObjectId().toString(), selectionMode: 'single', selectedOptions: [{ optionId: 'france', label: 'France' }] },
        { type: 'choice', componentId: 'choice-2', questionId: 'scope', sourceMessageId: new Types.ObjectId().toString(), selectionMode: 'single', selectedOptions: [{ optionId: 'germany', label: 'Germany' }] },
      ],
    } as any);

    expect(choiceInteractionService.canonicalizeMany).toHaveBeenCalledTimes(1);
    expect(messageService.createUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: '[{"selectedChoices":[{"submitText":"Use France"}]},{"selectedChoices":[{"submitText":"Use Germany"}]}]',
      interaction: undefined,
      interactions: expect.any(Array),
      replayContext: expect.objectContaining({
        content: '[{"selectedChoices":[{"submitText":"Use France"}]},{"selectedChoices":[{"submitText":"Use Germany"}]}]',
        taskSummary: 'France, Germany',
      }),
    }));
    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(),
      conversationId,
      expect.any(String),
      expect.objectContaining({
        content: '[{"selectedChoices":[{"submitText":"Use France"}]},{"selectedChoices":[{"submitText":"Use Germany"}]}]',
        taskSummary: 'France, Germany',
      }),
      'req-1',
      undefined,
      'Ada Lovelace',
      undefined,
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });

  it('queues a reliability rerun with the current user and request context', async () => {
    await expect(controller.rerunReliabilityEvaluation(user, conversationId, 'ai-1')).resolves.toEqual({
      messageId: 'ai-1', reliabilityEvaluation: { status: 'pending' },
    });

    expect(responseReliabilityService.rerun).toHaveBeenCalledWith({
      conversationId,
      messageId: 'ai-1',
      userId: userId.toString(),
      requestId: 'req-1',
    });
  });

  it('authorizes and propagates a selected semantic model into replay and stream context', async () => {
    const semanticModelId = '17b75421-e6c3-47b6-b220-4583d01fbd02';
    conversationService.getConversationDocument.mockResolvedValue({ isFirstMessage: false, taggedAgentIds: [] });

    await controller.sendMessage(user, conversationId, { content: 'question', semanticModelId } as any);

    expect(semanticModelService.resolveChatModel).toHaveBeenCalledWith(userId.toString(), semanticModelId);
    expect(messageService.createUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      replayContext: expect.objectContaining({ semanticModelId }),
    }));
    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(),
      conversationId,
      expect.any(String),
      expect.objectContaining({ semanticModelId }),
      'req-1',
      undefined,
      'Ada Lovelace',
      undefined,
      expect.objectContaining({ requestId: 'req-1' }),
    );
  });

  it('refuses a semantic model that is not published before creating the message or stream', async () => {
    const semanticModelId = '17b75421-e6c3-47b6-b220-4583d01fbd02';
    conversationService.getConversationDocument.mockResolvedValue({ isFirstMessage: false, taggedAgentIds: [] });
    semanticModelService.resolveChatModel.mockRejectedValueOnce(
      new ConflictException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Publish this semantic model to use it in chat'),
    );

    await expect(controller.sendMessage(user, conversationId, { content: 'question', semanticModelId } as any))
      .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE });

    expect(messageService.createUserMessage).not.toHaveBeenCalled();
    expect(streamService.startStream).not.toHaveBeenCalled();
  });

  it('forwards the frontend paint report to the message service with route identifiers', async () => {
    await controller.reportFrontendLatency(conversationId, 'ai-1', {
      schemaVersion: 1,
      requestId: 'req-1',
      frontendFirstChunkPaintedEpochMs: 1_000_500,
      frontendRenderMs: 80,
      browserRenderOnlyMs: 20,
      quality: 'ok',
    });

    expect(messageService.reportFrontendLatency).toHaveBeenCalledWith(
      conversationId,
      'ai-1',
      'req-1',
      {
        frontendFirstChunkPaintedEpochMs: 1_000_500,
        frontendRenderMs: 80,
        browserRenderOnlyMs: 20,
        quality: 'ok',
      },
    );
  });

  it('regenerates a platform copilot turn without a conversation-level playbook permission gate', async () => {
    const questionId = new Types.ObjectId();
    messageService.getMessageDocument
      .mockResolvedValueOnce({ questionMessageId: questionId })
      .mockResolvedValueOnce({ content: 'original question' });
    conversationService.getConversationDocument.mockResolvedValue({
      runtimePurpose: 'platform_copilot',
      pinnedAgentId: new Types.ObjectId(stickyAgentId),
    });

    await expect(controller.regenerate({ ...user, permissions: [] }, conversationId, 'ai-1'))
      .resolves.toEqual({ aiMessage: undefined });
    expect(conversationService.resolvePlatformCopilotAgent).toHaveBeenCalled();
    expect(messageService.createAIPlaceholder).toHaveBeenCalled();
  });

  it('reattaches a handoff when recovering an idempotent platform turn', async () => {
    const userMessageId = new Types.ObjectId().toString();
    const aiMessageId = new Types.ObjectId().toString();
    const dto = {
      content: 'Create a lead Playbook', requestId: 'turn-handoff', playbookHandoffId: randomUUID(),
    } as any;
    conversationService.getConversationDocument.mockResolvedValue({
      isFirstMessage: false,
      runtimePurpose: 'platform_copilot',
      pinnedAgentId: new Types.ObjectId(stickyAgentId),
      taggedAgentIds: [],
    });
    messageService.findTurnByRequestId.mockResolvedValue({
      userMessage: { id: userMessageId, content: dto.content },
      aiMessageId,
      requestFingerprint: (controller as any).fingerprintTurn(dto),
    });
    messageService.getMessageDocument.mockResolvedValue({ isComplete: true });

    await controller.sendMessage(user, conversationId, dto);

    expect(playbookHandoffService.bind).toHaveBeenCalledWith({
      handoffId: dto.playbookHandoffId,
      ownerId: userId.toString(),
      platformConversationId: conversationId,
      turnRequestId: dto.requestId,
      prompt: dto.content,
    });
    expect(playbookHandoffService.attachUserMessage).toHaveBeenCalledWith(
      dto.playbookHandoffId, userId.toString(), userMessageId,
    );
  });

  it('preserves model reasoning metadata on regenerated placeholders', async () => {
    const questionId = new Types.ObjectId();
    messageService.getMessageDocument
      .mockResolvedValueOnce({ questionMessageId: questionId })
      .mockResolvedValueOnce({ content: 'original question', modelId: 'model-1', reasoningEffort: 'high' });
    conversationService.getConversationDocument.mockResolvedValue({ runtimePurpose: 'standard' });

    await controller.regenerate(user, conversationId, 'ai-1');

    expect(messageService.createAIPlaceholder).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'model-1',
      reasoningEffort: 'high',
    }));
  });

  it('regenerates with the edited prompt instead of stale replay content', async () => {
    const questionId = new Types.ObjectId();
    const currentAgentId = new Types.ObjectId();
    messageService.getMessageDocument
      .mockResolvedValueOnce({ questionMessageId: questionId })
      .mockResolvedValueOnce({
        content: 'edited question',
        modelId: 'model-current',
        reasoningEffort: 'high',
        agentIds: [currentAgentId],
        replayContext: {
          content: 'original question',
          taskSummary: 'Choose the original option',
          modelId: 'model-old',
          reasoningEffort: 'low',
          agentIds: ['agent-old'],
          attachedFileIds: ['file-1'],
        },
      });
    conversationService.getConversationDocument.mockResolvedValue({ runtimePurpose: 'standard' });

    await controller.regenerate(user, conversationId, 'ai-1');

    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(),
      conversationId,
      expect.any(String),
      expect.objectContaining({
        content: 'edited question',
        modelId: 'model-current',
        reasoningEffort: 'high',
        agentIds: [currentAgentId.toString()],
        attachedFileIds: ['file-1'],
        taskSummary: undefined,
      }),
      'req-1',
      undefined,
      'Ada Lovelace',
      undefined,
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });

  it('preserves a replay task summary when the prompt was not edited', async () => {
    const questionId = new Types.ObjectId();
    messageService.getMessageDocument
      .mockResolvedValueOnce({ questionMessageId: questionId })
      .mockResolvedValueOnce({
        content: 'choose option b',
        replayContext: {
          content: 'choose option b',
          taskSummary: 'The user selected option B',
          agentIds: [],
        },
      });
    conversationService.getConversationDocument.mockResolvedValue({ runtimePurpose: 'standard' });

    await controller.regenerate(user, conversationId, 'ai-1');

    expect(streamService.startStream).toHaveBeenCalledWith(
      userId.toString(),
      conversationId,
      expect.any(String),
      expect.objectContaining({
        content: 'choose option b',
        taskSummary: 'The user selected option B',
      }),
      'req-1',
      undefined,
      'Ada Lovelace',
      undefined,
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });
});
