import { PostgresMessageStore } from './postgres-message-store';

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'a'.repeat(24),
    conversationId: 'b'.repeat(24),
    conversationType: 'ai',
    webSearchEnabled: false,
    isEdited: false,
    isStreaming: false,
    isComplete: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTx(currentRow: Record<string, unknown> | null, updatedRow: Record<string, unknown> | null) {
  const selectBuilder = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    for: jest.fn().mockResolvedValue(currentRow === null ? [] : [currentRow]),
  };
  const updateBuilder = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue(updatedRow === null ? [] : [updatedRow]),
  };
  const tx = {
    select: jest.fn().mockReturnValue(selectBuilder),
    update: jest.fn().mockReturnValue(updateBuilder),
  };
  return { tx, selectBuilder, updateBuilder };
}

function makeDb(tx: unknown) {
  return { transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(tx)) } as never;
}

const patch = {
  frontendFirstChunkPaintedEpochMs: 1_000_500,
  frontendRenderMs: 80,
  browserRenderOnlyMs: 20,
  quality: 'ok' as const,
};

describe('PostgresMessageStore.updateFrontendLatency', () => {
  const serverMetrics = {
    schemaVersion: 1,
    backendPreAdkMs: 120,
    providerTtftMs: 500,
    quality: 'ok',
  };

  it('merges the sixth metric while preserving the first five', async () => {
    const currentRow = makeRow({ requestId: 'req-1', latencyMetrics: serverMetrics });
    const updatedRow = makeRow({ requestId: 'req-1', latencyMetrics: { ...serverMetrics, ...patch } });
    const { tx, updateBuilder } = makeTx(currentRow, updatedRow);
    const store = new PostgresMessageStore(makeDb(tx));

    const result = await store.updateFrontendLatency(currentRow.id as string, 'req-1', patch);

    expect(result?.latencyMetrics).toMatchObject({
      backendPreAdkMs: 120,
      providerTtftMs: 500,
      frontendRenderMs: 80,
      browserRenderOnlyMs: 20,
      schemaVersion: 1,
    });
    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ latencyMetrics: expect.objectContaining({ frontendRenderMs: 80 }) }),
    );
  });

  it('is idempotent once a frontend paint value exists', async () => {
    const currentRow = makeRow({ requestId: 'req-1', latencyMetrics: { ...serverMetrics, frontendRenderMs: 99 } });
    const { tx, updateBuilder } = makeTx(currentRow, null);
    const store = new PostgresMessageStore(makeDb(tx));

    const result = await store.updateFrontendLatency(currentRow.id as string, 'req-1', patch);

    expect(result?.latencyMetrics?.frontendRenderMs).toBe(99);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('rejects a mismatched requestId', async () => {
    const currentRow = makeRow({ requestId: 'other-turn' });
    const { tx, updateBuilder } = makeTx(currentRow, null);
    const store = new PostgresMessageStore(makeDb(tx));

    const result = await store.updateFrontendLatency(currentRow.id as string, 'req-1', patch);

    expect(result).toBeNull();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('accepts a report when the persisted turn has no requestId', async () => {
    const currentRow = makeRow({ requestId: null });
    const updatedRow = makeRow({ requestId: null, latencyMetrics: patch });
    const { tx, updateBuilder } = makeTx(currentRow, updatedRow);
    const store = new PostgresMessageStore(makeDb(tx));

    const result = await store.updateFrontendLatency(currentRow.id as string, 'req-1', patch);

    expect(result).not.toBeNull();
    expect(updateBuilder.set).toHaveBeenCalled();
  });

  it('rejects non-AI messages and missing messages', async () => {
    const userRow = makeRow({ conversationType: 'user' });
    const { tx: tx1 } = makeTx(userRow, null);
    const store1 = new PostgresMessageStore(makeDb(tx1));
    expect(await store1.updateFrontendLatency(userRow.id as string, 'req-1', patch)).toBeNull();

    const { tx: tx2 } = makeTx(null, null);
    const store2 = new PostgresMessageStore(makeDb(tx2));
    expect(await store2.updateFrontendLatency('c'.repeat(24), 'req-1', patch)).toBeNull();
  });

  it('keeps the worse quality flag when merging', async () => {
    const currentRow = makeRow({ requestId: 'req-1', latencyMetrics: serverMetrics });
    const updatedRow = makeRow({ requestId: 'req-1' });
    const { tx, updateBuilder } = makeTx(currentRow, updatedRow);
    const store = new PostgresMessageStore(makeDb(tx));

    await store.updateFrontendLatency(currentRow.id as string, 'req-1', {
      ...patch,
      quality: 'clock-skew',
    });

    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ latencyMetrics: expect.objectContaining({ quality: 'clock-skew' }) }),
    );
  });
});
