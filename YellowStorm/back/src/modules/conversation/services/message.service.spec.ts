import { Types } from 'mongoose';
import { MessageService } from './message.service';

describe('MessageService createUserMessage agent tagging', () => {
  let messageModel: { create: jest.Mock; findById?: jest.Mock };
  let conversationService: {
    addMessageRef: jest.Mock;
    updateLastMessageAt: jest.Mock;
    updateTaggedAgents: jest.Mock;
    findById: jest.Mock;
  };
  let streamGateway: { broadcastToConversation: jest.Mock };
  let configService: { get: jest.Mock };
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let service: MessageService;

  const conversationId = new Types.ObjectId().toString();
  const senderId = new Types.ObjectId().toString();
  const agentId = new Types.ObjectId().toString();

  beforeEach(() => {
    messageModel = {
      create: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        conversationId: new Types.ObjectId(conversationId),
        senderId: new Types.ObjectId(senderId),
        conversationType: 'user',
        content: 'hello',
        agentIds: [new Types.ObjectId(agentId)],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    conversationService = {
      addMessageRef: jest.fn().mockResolvedValue(undefined),
      updateLastMessageAt: jest.fn().mockResolvedValue(undefined),
      updateTaggedAgents: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue({
        createdBy: senderId,
        groupMeta: undefined,
      }),
    };
    streamGateway = { broadcastToConversation: jest.fn().mockResolvedValue(undefined) };
    configService = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'conversation.maxMessageLength') return 50000;
        if (key === 'conversation.maxFilesPerMessage') return 5;
        if (key === 'app.frontendUrl') return 'http://localhost:5173';
        return fallback;
      }),
    };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    service = new MessageService(
      messageModel as any,
      conversationService as any,
      streamGateway as any,
      {} as any,
      configService as any,
      logger as any,
      {} as any,
    );

    // Avoid async mention side-effects in these unit tests
    jest
      .spyOn(service as any, 'extractAndNotifyMentions')
      .mockResolvedValue(undefined);
  });

  it('persists agentIds on the message and calls updateTaggedAgents', async () => {
    const result = await service.createUserMessage({
      conversationId,
      senderId,
      content: 'hello @agent',
      agentIds: [agentId],
    });

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentIds: [expect.any(Types.ObjectId)],
      }),
    );
    expect(conversationService.updateTaggedAgents).toHaveBeenCalledWith(
      conversationId,
      [agentId],
    );
    expect(result.agentIds).toEqual([agentId]);
  });

  it('does not call updateTaggedAgents when agentIds are absent', async () => {
    messageModel.create.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(senderId),
      conversationType: 'user',
      content: 'hello',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.createUserMessage({
      conversationId,
      senderId,
      content: 'hello',
    });

    expect(conversationService.updateTaggedAgents).not.toHaveBeenCalled();
  });

  it('removes raw tool results from public message responses', () => {
    const response = (service as any).mapToResponse({
      _id: new Types.ObjectId(),
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
      components: [{
        id: 'tool-1', type: 'toolInfo',
        data: { title: 'connector', status: 'completed', resultJson: '{"secret":"value"}', params: '{"query":"safe"}' },
      }],
    });

    expect(response.components[0].data).toEqual({ title: 'connector', status: 'completed', params: '{"query":"safe"}' });
  });

  it('upserts one sanitized correction attempt and protects its terminal decision', async () => {
    const document: any = {
      _id: new Types.ObjectId(),
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
      correctionWorkflow: {
        mode: 'corrective_transparent', status: 'correcting', activeVersion: 'original', threshold: 70,
        attemptCount: 1, maxAttempts: 1, failureBehavior: 'publish_with_warning', showOriginalAnswer: true,
        queuedAt: '2026-07-26T00:00:00.000Z', attempts: [],
      },
      save: jest.fn().mockResolvedValue(undefined),
    };
    messageModel.findById = jest.fn().mockResolvedValue(document);
    const base = { attemptId: 'attempt-1', attemptNumber: 1, policyReasons: [], createdAt: '2026-07-26T00:00:01.000Z' };

    await service.upsertCorrectionAttempt('message-1', { ...base, status: 'generating' });
    await service.upsertCorrectionAttempt('message-1', {
      ...base, status: 'rejected', decision: 'rejected', policyReasons: ['score_below_threshold'],
      components: [{ id: 'tool', type: 'toolInfo', data: { title: 'search', resultJson: '{"secret":"value"}' } }],
    });
    await service.upsertCorrectionAttempt('message-1', { ...base, status: 'generating' });

    expect(document.correctionWorkflow.attempts).toHaveLength(1);
    expect(document.correctionWorkflow.attempts[0]).toMatchObject({ status: 'rejected', policyReasons: ['score_below_threshold'] });
    expect(document.correctionWorkflow.attempts[0].components[0].data).toEqual({ title: 'search' });
  });
});
