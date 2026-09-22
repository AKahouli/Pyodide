import { PostgresMessageStore } from './postgres-message-store';

function storeForAggregate(row: Record<string, unknown>) {
  const where = jest.fn().mockResolvedValue([row]);
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  return new PostgresMessageStore({ select } as never);
}

describe('PostgresMessageStore conversation usage', () => {
  it.each([
    {
      name: 'all unknown',
      row: { eventCount: 2, pricedCount: 0, carbonCount: 0, costUsd: 0, carbonGramsCo2e: 0 },
      cost: { usd: null, complete: false },
      carbon: { gramsCo2e: null, complete: false },
    },
    {
      name: 'mixed',
      row: { eventCount: 2, pricedCount: 1, carbonCount: 1, costUsd: 0.25, carbonGramsCo2e: 3 },
      cost: { usd: 0.25, complete: false },
      carbon: { gramsCo2e: 3, complete: false },
    },
    {
      name: 'all known',
      row: { eventCount: 2, pricedCount: 2, carbonCount: 2, costUsd: 0.5, carbonGramsCo2e: 6 },
      cost: { usd: 0.5, complete: true },
      carbon: { gramsCo2e: 6, complete: true },
    },
  ])('preserves nullable aggregate semantics for $name events', async ({ row, cost, carbon }) => {
    const store = storeForAggregate({
      input: 10,
      output: 5,
      cachedInput: 2,
      reasoning: 1,
      total: 15,
      pricingVersions: [],
      methodologies: [],
      factorVersions: [],
      ...row,
    });

    await expect(store.getConversationUsage('conversation-1')).resolves.toMatchObject({
      tokens: { input: 10, output: 5, cachedInput: 2, reasoning: 1, total: 15 },
      cost,
      carbon,
    });
  });

  it('uses event-key conflict handling for idempotent inserts', async () => {
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoNothing });
    const insert = jest.fn().mockReturnValue({ values });
    const store = new PostgresMessageStore({ insert } as never);
    const event = {
      eventKey: 'execution:agent:model',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      executionId: 'execution',
      model: 'model',
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 2,
      costUsd: null,
      pricingVersion: null,
      carbonGramsCo2e: null,
      carbonMethodology: null,
      carbonFactorVersion: null,
    };

    await store.recordConversationUsageEvents([event]);

    expect(values).toHaveBeenCalledWith([expect.objectContaining(event)]);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});
