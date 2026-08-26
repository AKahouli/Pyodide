import { Types } from 'mongoose';
import { MessageService } from './message.service';

describe('MessageService createUserMessage agent tagging', () => {
  let messageModel: { create: jest.Mock; findById?: jest.Mock; findOne?: jest.Mock; findOneAndUpdate?: jest.Mock };
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

  it('includes sanitized bounded tool results in authorized message responses', () => {
    const toolComponent = {
      id: 'tool-1',
      data: { toolName: 'connector', status: 'completed', resultJson: '{"secret":"[REDACTED]"}', paramsJson: '{"query":"safe"}' },
    };
    // Mongoose subdocuments expose schema paths without making all of them enumerable.
    Object.defineProperty(toolComponent, 'type', { value: 'toolActivity', enumerable: false });
    const response = (service as any).mapToResponse({
      _id: new Types.ObjectId(),
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
      components: [toolComponent],
    });

    expect(response.components[0]).toEqual({
      id: 'tool-1',
      type: 'toolActivity',
      data: { toolName: 'connector', status: 'completed', resultJson: '{"secret":"[REDACTED]"}', paramsJson: '{"query":"safe"}' },
    });
  });

  it('preserves tool paths but removes credentials when authenticated display redaction is disabled', () => {
    (service as any).conversationSettings = { shouldRedactSensitiveText: () => false };
    const response = (service as any).mapToResponse({
      _id: new Types.ObjectId(),
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
      components: [{
        id: 'tool-private',
        type: 'toolActivity',
        data: { toolName: 'run_code', resultJson: '{"password":"private","path":"/workspace/run/file.txt"}' },
      }],
    });

    expect(response.components[0].data.resultJson).toContain('"password":"[REDACTED]"');
    expect(response.components[0].data.resultJson).toContain('/workspace/run/file.txt');
  });

  it('strips persisted artifact paths and private activity detail from message responses', () => {
    const response = (service as any).mapToResponse({
      _id: new Types.ObjectId(),
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
      components: [
        { id: 'artifact-1', type: 'artifact', data: { artifactId: 'opaque-1', filename: 'report.pdf', storagePath: 'owner/system_run/report.pdf' } },
        { id: 'activity-1', type: 'agentActivity', data: { summary: 'Reviewing evidence', detail: 'private reasoning', status: 'completed' } },
      ],
    });

    expect(response.components).toEqual([
      { id: 'artifact-1', type: 'artifact', data: { artifactId: 'opaque-1', filename: 'report.pdf' } },
      { id: 'activity-1', type: 'agentActivity', data: { summary: 'Reviewing evidence', status: 'completed' } },
    ]);
  });

  it('waits for the canonical completion update to broadcast', async () => {
    let finishBroadcast: () => void = () => undefined;
    streamGateway.broadcastToConversation.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishBroadcast = resolve;
    }));
    const messageId = new Types.ObjectId();
    const document: any = {
      _id: messageId,
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
      components: [],
      createdAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    messageModel.findById = jest.fn().mockResolvedValue(document);

    let completed = false;
    const completion = service.completeAIMessage({
      messageId: messageId.toString(),
      components: [{ id: 'tool-1', type: 'toolActivity', data: { title: 'search', status: 'completed', resultJson: '{"secret":true}', startedAt: '2026-07-29T08:00:00.000Z' } }],
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 1000,
    }).then(() => { completed = true; });

    await new Promise((resolve) => setImmediate(resolve));
    expect(streamGateway.broadcastToConversation).toHaveBeenCalledWith(
      [senderId],
      expect.objectContaining({
        type: 'message_updated',
        data: expect.objectContaining({
          messageId: messageId.toString(),
          message: expect.objectContaining({
            isComplete: true,
            components: [expect.objectContaining({ data: expect.objectContaining({ resultJson: '{"secret":"[REDACTED]"}' }) })],
          }),
        }),
      }),
    );
    expect(completed).toBe(false);

    finishBroadcast();
    await completion;
    expect(completed).toBe(true);
  });

  it('atomically claims a completed answer for a reliability rerun', async () => {
    const messageId = new Types.ObjectId();
    const document: any = {
      _id: messageId,
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
      isComplete: true,
      isStreaming: false,
      questionMessageId: new Types.ObjectId(),
      components: [{ id: 'answer', type: 'text', data: { content: 'Answer with a source.' } }],
      createdAt: new Date(),
    };
    messageModel.findOne = jest.fn().mockResolvedValue(document);
    messageModel.findOneAndUpdate = jest.fn().mockResolvedValue({
      ...document,
      reliabilityEvaluation: { status: 'pending', requestedAt: '2026-07-29T10:00:00.000Z' },
    });

    const result = await service.rerunReliabilityEvaluation(conversationId, messageId.toString());

    expect(result.reliabilityEvaluation).toMatchObject({ status: 'pending' });
    expect(messageModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: expect.objectContaining({ toString: expect.any(Function) }),
        conversationId: expect.objectContaining({ toString: expect.any(Function) }),
        'reliabilityEvaluation.status': { $ne: 'pending' },
      }),
      expect.objectContaining({ $set: expect.objectContaining({ reliabilityEvaluation: expect.objectContaining({ status: 'pending' }) }) }),
      { new: true },
    );
    expect(streamGateway.broadcastToConversation).toHaveBeenCalledWith(
      [senderId],
      expect.objectContaining({ type: 'message_updated' }),
    );
  });

  it('uses an absent-evaluation claim for automatic scheduling', async () => {
    const messageId = new Types.ObjectId();
    const document: any = {
      _id: messageId,
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
      isComplete: true,
      isStreaming: false,
      questionMessageId: new Types.ObjectId(),
      components: [{ id: 'answer', type: 'text', data: { content: 'Answer with a source.' } }],
      createdAt: new Date(),
    };
    messageModel.findOne = jest.fn().mockResolvedValue(document);
    messageModel.findOneAndUpdate = jest.fn().mockResolvedValue({
      ...document,
      reliabilityEvaluation: { status: 'pending', requestedAt: '2026-07-29T10:00:00.000Z' },
    });

    await service.claimReliabilityEvaluation(conversationId, messageId.toString(), false);

    expect(messageModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ reliabilityEvaluation: { $exists: false } }),
      expect.anything(),
      { new: true },
    );
  });

  it('rejects a correction claim after a manual evaluation claim is pending', async () => {
    messageModel.findOneAndUpdate = jest.fn().mockResolvedValue(null);

    await expect(service.claimCorrectionRun('message-1', 'correction-run-1', '2026-07-29T10:00:00.000Z')).resolves.toBe(false);

    expect(messageModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'message-1',
        'reliabilityEvaluation.status': { $ne: 'pending' },
      }),
      expect.anything(),
      { new: true },
    );
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
      components: [{ id: 'tool', type: 'toolActivity', data: { title: 'search', resultJson: '{"secret":"value"}' } }],
    });
    await service.upsertCorrectionAttempt('message-1', { ...base, status: 'generating' });

    expect(document.correctionWorkflow.attempts).toHaveLength(1);
    expect(document.correctionWorkflow.attempts[0]).toMatchObject({ status: 'rejected', policyReasons: ['score_below_threshold'] });
    expect(document.correctionWorkflow.attempts[0].components[0].data).toEqual({ title: 'search' });
  });

  it('atomically claims an expired or unclaimed AI stream execution lease', async () => {
    const exec = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });
    const lean = jest.fn().mockReturnValue({ exec });
    messageModel.findOneAndUpdate = jest.fn().mockReturnValue({ lean });

    await expect(service.claimStreamExecution(new Types.ObjectId().toString(), 'lease-1', 90_000))
      .resolves.toBe(true);
    expect(messageModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationType: 'ai',
        isComplete: { $ne: true },
        $or: expect.arrayContaining([
          { streamExecutionLeaseExpiresAt: { $exists: false } },
          { streamExecutionLeaseExpiresAt: null },
        ]),
      }),
      expect.objectContaining({ $set: expect.objectContaining({ streamExecutionLeaseId: 'lease-1' }) }),
      { new: true },
    );
  });

  it('denies a stream execution lease while another instance owns it', async () => {
    const exec = jest.fn().mockResolvedValue(null);
    const lean = jest.fn().mockReturnValue({ exec });
    messageModel.findOneAndUpdate = jest.fn().mockReturnValue({ lean });

    await expect(service.claimStreamExecution(new Types.ObjectId().toString(), 'lease-2', 90_000))
      .resolves.toBe(false);
  });

  it('allows only one simulated service instance to claim the same stream execution', async () => {
    const results = [{ _id: new Types.ObjectId() }, null];
    messageModel.findOneAndUpdate = jest.fn().mockImplementation(() => {
      const exec = jest.fn().mockResolvedValue(results.shift());
      const lean = jest.fn().mockReturnValue({ exec });
      return { lean };
    });
    const otherInstance = new MessageService(
      messageModel as any,
      conversationService as any,
      streamGateway as any,
      {} as any,
      configService as any,
      logger as any,
      {} as any,
    );
    const messageId = new Types.ObjectId().toString();

    await expect(Promise.all([
      service.claimStreamExecution(messageId, 'instance-a', 90_000),
      otherInstance.claimStreamExecution(messageId, 'instance-b', 90_000),
    ])).resolves.toEqual([true, false]);
  });

  it('completes a stream only while the matching durable lease still owns it', async () => {
    const messageId = new Types.ObjectId();
    const document: any = {
      _id: messageId,
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
      components: [{ id: 'text-1', type: 'text', data: { content: 'done' } }],
      isStreaming: false,
      isComplete: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const exec = jest.fn().mockResolvedValue(document);
    messageModel.findOneAndUpdate = jest.fn().mockReturnValue({ exec });

    await service.completeAIMessage({
      messageId: messageId.toString(),
      streamExecutionLeaseId: 'lease-1',
      components: document.components,
    });

    expect(messageModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: expect.any(Types.ObjectId),
        streamExecutionLeaseId: 'lease-1',
        isComplete: { $ne: true },
      },
      expect.objectContaining({ $set: expect.objectContaining({ isComplete: true, isStreaming: false }) }),
      { new: true },
    );
  });
});
