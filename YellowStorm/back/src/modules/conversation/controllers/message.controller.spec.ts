import { Types } from 'mongoose';
import { MessageController } from './message.controller';

describe('MessageController.sendMessage sticky routing', () => {
  const userId = new Types.ObjectId();
  const conversationId = new Types.ObjectId().toString();
  const stickyAgentId = new Types.ObjectId().toString();
  const mentionedAgentId = new Types.ObjectId().toString();

  let messageService: {
    createUserMessage: jest.Mock;
    createAIPlaceholder: jest.Mock;
    markStreamFailed: jest.Mock;
  };
  let streamService: {
    isAvailable: jest.Mock;
    startStream: jest.Mock;
    generateConversationNameAsync: jest.Mock;
  };
  let conversationService: {
    getConversationDocument: jest.Mock;
    updateConversationInternal: jest.Mock;
    replaceTaggedAgentIds: jest.Mock;
    ensureSystemWorkspace: jest.Mock;
  };
  let modelsService: { validateModelActive: jest.Mock };
  let teamService: { resolveAgentIds: jest.Mock };
  let requestContext: { getRequestId: jest.Mock };
  let choiceInteractionService: { canonicalize: jest.Mock };
  let responseReliabilityService: { rerun: jest.Mock };
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
  } as any;

  beforeEach(() => {
    messageService = {
      createUserMessage: jest.fn().mockResolvedValue({
        id: new Types.ObjectId().toString(),
        agentIds: [],
      }),
      createAIPlaceholder: jest.fn().mockResolvedValue({
        id: new Types.ObjectId().toString(),
      }),
      markStreamFailed: jest.fn(),
    };
    streamService = {
      isAvailable: jest.fn().mockReturnValue(true),
      startStream: jest.fn().mockResolvedValue(undefined),
      generateConversationNameAsync: jest.fn(),
    };
    conversationService = {
      getConversationDocument: jest.fn(),
      updateConversationInternal: jest.fn().mockResolvedValue(undefined),
      replaceTaggedAgentIds: jest.fn().mockResolvedValue(undefined),
      ensureSystemWorkspace: jest.fn().mockResolvedValue(undefined),
    };
    modelsService = { validateModelActive: jest.fn() };
    teamService = { resolveAgentIds: jest.fn().mockResolvedValue([]) };
    requestContext = { getRequestId: jest.fn().mockReturnValue('req-1') };
    choiceInteractionService = { canonicalize: jest.fn() };
    responseReliabilityService = { rerun: jest.fn().mockResolvedValue({ messageId: 'ai-1', reliabilityEvaluation: { status: 'pending' } }) };
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
    );
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
    );
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
});
