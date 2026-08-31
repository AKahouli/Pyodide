import { Types } from 'mongoose';
import { MessageService } from './message.service';

describe('MessageService store lifecycle', () => {
  let messageStore: Record<string, jest.Mock>;
  let conversationService: Record<string, jest.Mock>;
  let streamGateway: Record<string, jest.Mock>;
  let conversationSettings: Record<string, jest.Mock>;
  let service: MessageService;

  const conversationId = new Types.ObjectId().toString();
  const senderId = new Types.ObjectId().toString();
  const agentId = new Types.ObjectId().toString();
  const record = (patch: Record<string, unknown> = {}) => ({
    id: new Types.ObjectId().toString(),
    conversationId,
    senderId,
    conversationType: 'user',
    content: 'hello',
    components: [],
    agentIds: [agentId],
    webSearchEnabled: false,
    isEdited: false,
    isStreaming: false,
    isComplete: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  });

  beforeEach(() => {
    messageStore = {
      createUser: jest.fn().mockResolvedValue(record()),
      createAiPlaceholder: jest.fn(),
      completeAi: jest.fn(),
      findById: jest.fn(),
      listPage: jest.fn(),
      listCursor: jest.fn(),
      listByConversation: jest.fn(),
      findBranchesByQuestions: jest.fn(),
      findTurnByRequestId: jest.fn(),
      updateFeedback: jest.fn(),
      updateReliability: jest.fn(),
      claimStream: jest.fn(),
      renewStream: jest.fn(),
      releaseStream: jest.fn(),
      claimReliability: jest.fn(),
      updateCorrectionWorkflow: jest.fn(),
      claimCorrectionRun: jest.fn(),
      upsertCorrectionAttempt: jest.fn(),
      failStaleReliability: jest.fn(),
      touchPendingReliability: jest.fn(),
      markStreamFailed: jest.fn(),
      cleanupStaleStreams: jest.fn(),
      updateUser: jest.fn(),
      deleteByConversation: jest.fn(),
      findBranchesByQuestion: jest.fn(),
      findAiComponents: jest.fn(),
      findReportMessageById: jest.fn(),
    };
    conversationService = {
      updateTaggedAgents: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue({ createdBy: senderId }),
      addMention: jest.fn(),
    };
    streamGateway = {
      broadcastToConversation: jest.fn().mockResolvedValue(undefined),
      sendToUser: jest.fn(),
    };
    conversationSettings = {
      shouldRedactSensitiveText: jest.fn().mockReturnValue(true),
      getSettings: jest.fn().mockResolvedValue({ redactSensitiveText: true }),
    };
    const configService = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'conversation.maxMessageLength') return 50000;
        if (key === 'conversation.maxFilesPerMessage') return 5;
        if (key === 'app.frontendUrl') return 'http://localhost:5173';
        return fallback;
      }),
    };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    service = new MessageService(
      messageStore as never,
      conversationService as never,
      streamGateway as never,
      {} as never,
      configService as never,
      logger as never,
      {} as never,
      conversationSettings as never,
    );
    jest.spyOn(service as any, 'extractAndNotifyMentions').mockResolvedValue(undefined);
  });

  it('persists neutral agent IDs through the store', async () => {
    const result = await service.createUserMessage({
      conversationId,
      senderId,
      content: 'hello @agent',
      agentIds: [agentId],
    });
    expect(messageStore.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ agentIds: [agentId] }),
    );
    expect(result.agentIds).toEqual([agentId]);
  });

  it('updates conversation tags when agent IDs are present', async () => {
    await service.createUserMessage({
      conversationId,
      senderId,
      content: 'hello',
      agentIds: [agentId],
    });
    expect(conversationService.updateTaggedAgents).toHaveBeenCalledWith(conversationId, [agentId]);
  });

  it('does not update conversation tags when agent IDs are absent', async () => {
    await service.createUserMessage({ conversationId, senderId, content: 'hello' });
    expect(conversationService.updateTaggedAgents).not.toHaveBeenCalled();
  });

  it('sanitizes bounded tool results in authorized responses', () => {
    const response = (service as any).mapToResponse(record({
      conversationType: 'ai',
      components: [{
        id: 'tool-1',
        type: 'toolActivity',
        data: {
          toolName: 'connector',
          status: 'completed',
          resultJson: '{"secret":"[REDACTED]"}',
          paramsJson: '{"query":"safe"}',
        },
      }],
    }));
    expect(response.components[0].data.resultJson).toBe('{"secret":"[REDACTED]"}');
  });

  it('strips persisted artifact paths while preserving activity detail', () => {
    const response = (service as any).mapToResponse(record({
      conversationType: 'ai',
      components: [
        { id: 'artifact-1', type: 'artifact', data: { artifactId: 'opaque-1', filename: 'report.pdf', storagePath: 'owner/run/report.pdf' } },
        { id: 'activity-1', type: 'agentActivity', data: { summary: 'Reviewing', detail: 'detail', status: 'completed' } },
      ],
    }));
    expect(response.components).toEqual([
      { id: 'artifact-1', type: 'artifact', data: { artifactId: 'opaque-1', filename: 'report.pdf' } },
      { id: 'activity-1', type: 'agentActivity', data: { summary: 'Reviewing', detail: 'detail', status: 'completed' } },
    ]);
  });

  it('awaits the current redaction setting when loading persisted messages', async () => {
    conversationSettings.shouldRedactSensitiveText.mockReturnValue(true);
    conversationSettings.getSettings.mockResolvedValue({ redactSensitiveText: false });
    messageStore.listPage.mockResolvedValue({
      records: [record({
        conversationType: 'ai',
        components: [{
          id: 'answer',
          type: 'text',
          data: { content: 'Cover pool au 30/06/2025 — 19 931,3 M€' },
        }],
      })],
      total: 1,
    });

    const result = await service.findByConversation(conversationId, {});

    expect(conversationSettings.getSettings).toHaveBeenCalled();
    expect(result.messages[0].components?.[0].data.content)
      .toBe('Cover pool au 30/06/2025 — 19 931,3 M€');
  });

  it('fails closed when the current redaction setting cannot be loaded', async () => {
    conversationSettings.getSettings.mockRejectedValue(new Error('settings unavailable'));
    messageStore.listPage.mockResolvedValue({
      records: [record({
        conversationType: 'ai',
        components: [{
          id: 'answer',
          type: 'text',
          data: { content: 'Stored at owner/runs/private/result.txt' },
        }],
      })],
      total: 1,
    });

    const result = await service.findByConversation(conversationId, {});

    expect(result.messages[0].components?.[0].data.content).toContain('[REDACTED]');
  });

  it('fails closed without hanging when the redaction setting lookup stalls', async () => {
    jest.useFakeTimers();
    try {
      conversationSettings.getSettings.mockReturnValue(new Promise(() => undefined));
      messageStore.listPage.mockResolvedValue({
        records: [record({
          conversationType: 'ai',
          components: [{
            id: 'answer',
            type: 'text',
            data: { content: 'Stored at owner/runs/private/result.txt' },
          }],
        })],
        total: 1,
      });

      const resultPromise = service.findByConversation(conversationId, {});
      await jest.advanceTimersByTimeAsync(1_000);
      const result = await resultPromise;

      expect(result.messages[0].components?.[0].data.content).toContain('[REDACTED]');
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the current redaction setting for cursor messages and branches', async () => {
    conversationSettings.getSettings.mockResolvedValue({ redactSensitiveText: false });
    const question = record();
    const answer = record({
      conversationType: 'ai',
      components: [{
        id: 'answer',
        type: 'text',
        data: { content: 'Cover pool au 30/06/2025 — 19 931,3 M€' },
      }],
    });
    messageStore.listCursor.mockResolvedValue({
      records: [question],
      hasMore: false,
      nextCursor: undefined,
    });
    messageStore.findBranchesByQuestions.mockResolvedValue(
      new Map([[question.id, [answer]]]),
    );

    const result = await service.findByConversation(conversationId, { mode: 'cursor' });

    expect('branchesByQuestion' in result && result.branchesByQuestion[question.id][0]
      .components?.[0].data.content).toBe('Cover pool au 30/06/2025 — 19 931,3 M€');
  });

  it('uses the current redaction setting when loading a message by id', async () => {
    conversationSettings.getSettings.mockResolvedValue({ redactSensitiveText: false });
    const answer = record({
      conversationType: 'ai',
      components: [{
        id: 'answer',
        type: 'text',
        data: { content: 'Cover pool au 30/06/2025 — 19 931,3 M€' },
      }],
    });
    messageStore.findById.mockResolvedValue(answer);

    const result = await service.findById(answer.id);

    expect(result.components?.[0].data.content)
      .toBe('Cover pool au 30/06/2025 — 19 931,3 M€');
  });

  it('awaits the canonical completion broadcast', async () => {
    let finishBroadcast: () => void = () => undefined;
    streamGateway.broadcastToConversation.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishBroadcast = resolve; }),
    );
    const message = record({
      conversationType: 'ai',
      components: [{ id: 'tool-1', type: 'toolActivity', data: { resultJson: '{"secret":true}' } }],
    });
    messageStore.completeAi.mockResolvedValue(message);
    let completed = false;
    const completion = service.completeAIMessage({
      messageId: message.id,
      components: message.components,
    }).then(() => { completed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    finishBroadcast();
    await completion;
    expect(completed).toBe(true);
  });

  it('claims a completed answer for a manual reliability rerun', async () => {
    const message = record({
      conversationType: 'ai',
      questionMessageId: new Types.ObjectId().toString(),
      components: [{ id: 'answer', type: 'text', data: { content: 'Answer with source.' } }],
    });
    const claimed = record({
      ...message,
      reliabilityEvaluation: { status: 'pending', requestedAt: '2026-07-29T10:00:00.000Z' },
    });
    messageStore.findById.mockResolvedValue(message);
    messageStore.claimReliability.mockResolvedValue(claimed);
    const result = await service.rerunReliabilityEvaluation(conversationId, message.id);
    expect(result.reliabilityEvaluation).toMatchObject({ status: 'pending' });
    expect(messageStore.claimReliability).toHaveBeenCalledWith(
      conversationId,
      message.id,
      true,
      expect.any(String),
    );
  });

  it('uses the automatic reliability claim mode', async () => {
    const message = record({
      conversationType: 'ai',
      questionMessageId: new Types.ObjectId().toString(),
      components: [{ id: 'answer', type: 'text', data: { content: 'Answer.' } }],
    });
    messageStore.findById.mockResolvedValue(message);
    messageStore.claimReliability.mockResolvedValue({
      ...message,
      reliabilityEvaluation: { status: 'pending', requestedAt: new Date().toISOString() },
    });
    await service.claimReliabilityEvaluation(conversationId, message.id, false);
    expect(messageStore.claimReliability).toHaveBeenCalledWith(
      conversationId,
      message.id,
      false,
      expect.any(String),
    );
  });

  it('does not expose reliability state for a message in another conversation', async () => {
    const message = record({
      conversationId: new Types.ObjectId().toString(),
      conversationType: 'ai',
      questionMessageId: new Types.ObjectId().toString(),
      components: [{ id: 'answer', type: 'text', data: { content: 'Answer.' } }],
      reliabilityEvaluation: { status: 'pending', requestedAt: new Date().toISOString() },
    });
    messageStore.findById.mockResolvedValue(message);
    await expect(
      service.claimReliabilityEvaluation(conversationId, message.id, true),
    ).rejects.toThrow('Message not found');
    expect(messageStore.claimReliability).not.toHaveBeenCalled();
  });

  it('delegates correction-run ownership to the atomic store operation', async () => {
    messageStore.claimCorrectionRun.mockResolvedValue(false);
    await expect(
      service.claimCorrectionRun('message-1', 'run-1', '2026-07-29T10:00:00.000Z'),
    ).resolves.toBe(false);
    expect(messageStore.claimCorrectionRun).toHaveBeenCalledWith(
      'message-1',
      'run-1',
      '2026-07-29T10:00:00.000Z',
      expect.any(String),
    );
  });

  it('sanitizes a correction attempt before persistence', async () => {
    const message = record({
      conversationType: 'ai',
      correctionWorkflow: {
        mode: 'corrective_transparent',
        status: 'correcting',
        activeVersion: 'original',
        threshold: 70,
        attemptCount: 1,
        maxAttempts: 1,
        failureBehavior: 'publish_with_warning',
        showOriginalAnswer: true,
        queuedAt: '2026-07-26T00:00:00.000Z',
        attempts: [],
      },
    });
    messageStore.upsertCorrectionAttempt.mockResolvedValue(message);
    await service.upsertCorrectionAttempt('message-1', {
      attemptId: 'attempt-1',
      attemptNumber: 1,
      status: 'rejected',
      decision: 'rejected',
      policyReasons: ['score_below_threshold'],
      createdAt: '2026-07-26T00:00:01.000Z',
      components: [{ id: 'tool', type: 'toolActivity', data: { title: 'search', resultJson: '{"secret":"value"}' } }],
    });
    expect(messageStore.upsertCorrectionAttempt).toHaveBeenCalledWith(
      'message-1',
      expect.objectContaining({
        components: [{ id: 'tool', type: 'toolActivity', data: { title: 'search' } }],
      }),
      undefined,
    );
  });

  it('allows only one simulated service instance to claim a stream lease', async () => {
    messageStore.claimStream.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const messageId = new Types.ObjectId().toString();
    await expect(Promise.all([
      service.claimStreamExecution(messageId, 'instance-a', 90_000),
      service.claimStreamExecution(messageId, 'instance-b', 90_000),
    ])).resolves.toEqual([true, false]);
    expect(messageStore.claimStream).toHaveBeenCalledTimes(2);
  });

  it('passes the durable lease through completion', async () => {
    const message = record({ conversationType: 'ai' });
    messageStore.completeAi.mockResolvedValue(message);
    await service.completeAIMessage({
      messageId: message.id,
      streamExecutionLeaseId: 'lease-1',
      components: [],
    });
    expect(messageStore.completeAi).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id, streamExecutionLeaseId: 'lease-1' }),
    );
  });
});
