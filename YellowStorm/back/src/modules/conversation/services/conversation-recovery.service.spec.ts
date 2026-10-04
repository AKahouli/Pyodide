import { ConversationRecoveryService } from './conversation-recovery.service';

describe('ConversationRecoveryService (WP06.5)', () => {
  const build = (
    expired: {
      id: string;
      conversationId: string;
      executionAttemptId: string | null;
      leaseExpiresAt: Date | null;
    }[],
    overrides: { settledIds?: Set<string>; findError?: Error } = {},
  ) => {
    const messageService = {
      findExpiredStreamExecutions: jest.fn(async () => {
        if (overrides.findError) throw overrides.findError;
        return expired;
      }),
      markExecutionInterrupted: jest.fn(async (id: string) => {
        if (overrides.settledIds && !overrides.settledIds.has(id)) return null;
        const found = expired.find((e) => e.id === id);
        return found
          ? { id: found.id, conversationId: found.conversationId, executionAttemptId: found.executionAttemptId }
          : null;
      }),
    };
    const conversationService = {
      findById: jest.fn(async (conversationId: string) => ({
        createdBy: 'owner-1',
        groupMeta: { isGroup: true, members: [{ userId: 'member-1' }, { userId: 'owner-1' }] },
        conversationId,
      })),
    };
    const streamGateway = { broadcastToConversation: jest.fn().mockResolvedValue(undefined) };
    const configValues: Record<string, unknown> = {
      'conversation.recoveryEnabled': true,
      'conversation.recoveryIntervalMs': 30_000,
      'conversation.recoveryGraceMs': 60_000,
    };
    const configService = { get: jest.fn((k: string, def?: unknown) => configValues[k] ?? def) };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const executionStore = { finalizeExpired: jest.fn().mockResolvedValue(0) };
    const service = new ConversationRecoveryService(
      messageService as never,
      conversationService as never,
      streamGateway as never,
      configService as never,
      logger as never,
      executionStore as never,
    );
    return { service, messageService, conversationService, streamGateway, logger, executionStore };
  };

  it('settles expired attempts as interrupted and notifies all members once', async () => {
    const { service, messageService, streamGateway } = build([
      { id: 'msg-1', conversationId: 'conv-1', executionAttemptId: 'lease-1', leaseExpiresAt: new Date(Date.now() - 120_000) },
    ]);

    const result = await service.runRecoveryPass();

    expect(result).toEqual({ scanned: 1, interrupted: 1 });
    const [cutoffArg] = (messageService.findExpiredStreamExecutions as jest.Mock).mock.calls[0];
    expect(cutoffArg.getTime()).toBeLessThanOrEqual(Date.now() - 59_000);
    expect(messageService.markExecutionInterrupted).toHaveBeenCalledWith('msg-1', 'lease_expired', expect.any(Date));
    expect(streamGateway.broadcastToConversation).toHaveBeenCalledWith(
      ['owner-1', 'member-1'],
      expect.objectContaining({
        type: 'stream_error',
        data: expect.objectContaining({ conversationId: 'conv-1', messageId: 'msg-1' }),
      }),
    );
  });

  it('skips attempts already settled by another replica without notifying', async () => {
    const { service, streamGateway } = build(
      [{ id: 'msg-1', conversationId: 'conv-1', executionAttemptId: null, leaseExpiresAt: null }],
      { settledIds: new Set<string>() },
    );

    const result = await service.runRecoveryPass();

    expect(result.interrupted).toBe(0);
    expect(streamGateway.broadcastToConversation).not.toHaveBeenCalled();
  });

  it('is single-flight: a concurrent pass is a no-op', async () => {
    const { service, messageService } = build(
      [{ id: 'msg-1', conversationId: 'conv-1', executionAttemptId: null, leaseExpiresAt: null }],
    );
    let release!: () => void;
    (messageService.findExpiredStreamExecutions as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { release = () => { resolve([]); }; }),
    );

    const first = service.runRecoveryPass();
    const second = await service.runRecoveryPass();
    release();
    await first;

    expect(second).toEqual({ scanned: 0, interrupted: 0 });
    expect((messageService.findExpiredStreamExecutions as jest.Mock).mock.calls.length).toBe(1);
  });

  it('survives a failing scan and keeps the worker alive', async () => {
    const { service } = build([], { findError: new Error('postgres down') });
    await expect(service.runRecoveryPass()).resolves.toEqual({ scanned: 0, interrupted: 0 });
  });

  it('latches a schema-missing error to one actionable log instead of spamming', async () => {
    const missingColumn = Object.assign(new Error('column execution_status does not exist'), {
      code: '42703',
    });
    const { service, logger } = build([], { findError: missingColumn });

    await service.runRecoveryPass();
    await service.runRecoveryPass();
    await service.runRecoveryPass();

    const schemaErrors = logger.error.mock.calls.filter((c) =>
      String(c[0]).includes('migration 0010 not applied'),
    );
    expect(schemaErrors).toHaveLength(1);
    const scanErrors = logger.error.mock.calls.filter((c) =>
      String(c[0]).includes('Recovery scan failed'),
    );
    expect(scanErrors).toHaveLength(0);
  });

  it('detects a missing schema via a wrapped (drizzle) error cause', async () => {
    const wrapped = Object.assign(new Error('Failed query: select ...'), {
      cause: { code: '42P01' },
    });
    const { service, logger } = build([], { findError: wrapped });

    await service.runRecoveryPass();

    expect(
      logger.error.mock.calls.some((c) => String(c[0]).includes('migration 0010 not applied')),
    ).toBe(true);
  });
});
