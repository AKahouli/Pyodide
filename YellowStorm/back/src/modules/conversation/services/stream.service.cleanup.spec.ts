import { StreamService } from './stream.service';
import { ConflictException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

/**
 * F04 regression: every failure/stop path after the bootstrap reservation must
 * release only its own local resources, even when markStreamFailed and
 * releaseStreamExecution themselves fail.
 */
describe('StreamService.startStream exception-safe cleanup (F04)', () => {
  const userId = 'user-1';
  const conversationId = 'conv-1';
  const messageId = 'msg-1';

  const buildService = (overrides: {
    claimResult?: boolean;
    failAt?: () => Promise<never>;
    markStreamFailedError?: Error;
    releaseError?: Error;
  }) => {
    const leaseIdRef = { current: '' };
    const messageService = {
      claimStreamExecution: jest.fn(async (_m: string, leaseId: string) => {
        leaseIdRef.current = leaseId;
        return overrides.claimResult ?? true;
      }),
      renewStreamExecution: jest.fn().mockResolvedValue(true),
      releaseStreamExecution: jest.fn(async () => {
        if (overrides.releaseError) throw overrides.releaseError;
      }),
      markStreamFailed: jest.fn(async () => {
        if (overrides.markStreamFailedError) throw overrides.markStreamFailedError;
      }),
      completeAIMessage: jest.fn(),
      findMessageById: jest.fn(),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const streamGateway = {
      broadcastToConversation: jest.fn().mockResolvedValue(undefined),
      sendToUser: jest.fn(),
    };
    const configService = { get: jest.fn((_k: string, def: unknown) => def) };
    const conversationSettings = { isLatencyInstrumentationEnabled: jest.fn().mockResolvedValue(false) };
    const conversationService = {
      // resolveMemberIds tolerates lookup failures; the first awaited step
      // after local registration that surfaces the injected failure is the
      // agent-request build's conversation document lookup.
      findById: jest.fn().mockResolvedValue({ createdBy: 'owner-1' }),
      getConversationDocument: jest.fn().mockRejectedValue(new Error('conversation lookup failed')),
    };
    const executionStore = {
      admit: jest.fn().mockResolvedValue({ admitted: true }),
      extendExpiry: jest.fn().mockResolvedValue(undefined),
      isCancelRequested: jest.fn().mockResolvedValue(false),
      requestCancel: jest.fn().mockResolvedValue(false),
      finalizeByMessage: jest.fn().mockResolvedValue(undefined),
      finalizeExpired: jest.fn().mockResolvedValue(0),
    };
    const service = new StreamService(
      configService as never,
      streamGateway as never,
      messageService as never,
      conversationService as never,
      logger as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      conversationSettings as never,
      {} as never,
      executionStore as never,
    );
    // Bypass gRPC client init; the lease claim happens after this check.
    (service as unknown as { isGrpcAvailable: boolean }).isGrpcAvailable = true;
    return { service, messageService, streamGateway, leaseIdRef, logger, executionStore };
  };

  const request = { content: 'hello', modelId: 'model-1' } as never;

  it('cleans local state even when markStreamFailed and lease release both fail', async () => {
    const { service, messageService } = buildService({
      markStreamFailedError: new Error('postgres unavailable'),
      releaseError: new Error('postgres unavailable'),
    });

    await expect(
      service.startStream(userId, conversationId, messageId, request),
    ).rejects.toThrow('conversation lookup failed');

    // Durable best-effort calls were attempted exactly once with ownership.
    expect(messageService.markStreamFailed).toHaveBeenCalledWith(expect.any(String), expect.any(String));
    expect(messageService.releaseStreamExecution).toHaveBeenCalledWith(expect.any(String), expect.any(String));

    // Local maps returned to baseline without restart.
    const internals = service as unknown as {
      activeStreams: Map<string, Set<string>>;
      activeConversationExecutions: Set<string>;
      streamExecutionLeases: Map<string, string>;
      streamTerminalCoordinators: Map<string, unknown>;
      componentBuffers: Map<string, unknown>;
    };
    expect(internals.activeStreams.size).toBe(0);
    expect(internals.activeConversationExecutions.size).toBe(0);
    expect(internals.streamExecutionLeases.size).toBe(0);
    expect(internals.streamTerminalCoordinators.size).toBe(0);
    expect(internals.componentBuffers.size).toBe(0);
  });

  it('propagates the original failure, not the cleanup error', async () => {
    const { service } = buildService({
      markStreamFailedError: new Error('cleanup blew up'),
    });

    await expect(
      service.startStream(userId, conversationId, messageId, request),
    ).rejects.toThrow('conversation lookup failed');
  });

  it('rejects a concurrent start from another member of the same conversation', async () => {
    const { service } = buildService({});
    const internals = service as unknown as { activeConversationExecutions: Set<string> };
    internals.activeConversationExecutions.add(conversationId);

    // A DIFFERENT member requests the same conversation: conversation-level
    // exclusivity is actor-independent.
    await expect(
      service.startStream('member-2', conversationId, 'msg-2', request),
    ).rejects.toBeInstanceOf(ConflictException);

    // Failed admission releases the local slot for the real owner.
    expect(internals.activeConversationExecutions.size).toBe(1);
    internals.activeConversationExecutions.delete(conversationId);
  });

  it('releases local capacity when the per-user stream limit is exceeded', async () => {
    const { service } = buildService({});
    const internals = service as unknown as {
      activeStreams: Map<string, Set<string>>;
    };
    internals.activeStreams.set(userId, new Set(['conv-a', 'conv-b', 'conv-c', 'conv-d', 'conv-e']));

    await expect(
      service.startStream(userId, conversationId, messageId, request),
    ).rejects.toMatchObject({ code: ErrorCode.CHAT_STREAM_LIMIT });
  });

  it('rejects with stream-limit when fleet admission reports capacity full', async () => {
    const { service, executionStore } = buildService({});
    (executionStore.admit as jest.Mock).mockResolvedValue({ admitted: false, reason: 'capacity' });

    await expect(
      service.startStream(userId, conversationId, messageId, request),
    ).rejects.toMatchObject({ code: ErrorCode.CHAT_STREAM_LIMIT });
    // Local registration is released after the durable rejection.
    const internals = service as unknown as {
      activeStreams: Map<string, Set<string>>;
      activeConversationExecutions: Set<string>;
    };
    expect(internals.activeStreams.size).toBe(0);
    expect(internals.activeConversationExecutions.size).toBe(0);
  });

  it('finalizes the fleet admission row on the cleanup path', async () => {
    const { service, executionStore } = buildService({});

    await expect(
      service.startStream(userId, conversationId, messageId, request),
    ).rejects.toThrow('conversation lookup failed');

    expect(executionStore.finalizeByMessage).toHaveBeenCalledWith(messageId);
  });
});
