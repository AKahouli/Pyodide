import { randomBytes } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { conversations, messages } from '../../../postgres/schema';
import { PostgresMessageStore } from './postgres-message-store';

describeIntegration('Conversation message navigation', () => {
  const database = makeTestDb();
  const store = new PostgresMessageStore(database.db);
  const id = () => randomBytes(12).toString('hex');
  const fixtures: string[] = [];
  async function seed() {
    const conversationId = id(); fixtures.push(conversationId);
    await database.db.insert(conversations).values({ id: conversationId, createdBy: id() });
    return conversationId;
  }
  afterEach(async () => { if (fixtures.length) await database.db.delete(conversations).where(inArray(conversations.id, fixtures.splice(0))); });
  afterAll(database.close);

  it('searches literal case-insensitive text with bounded snippets, never foreign, deleted or raw program content', async () => {
    const conversationId = await seed(), foreign = await seed();
    await database.db.insert(messages).values([
      { id: id(), conversationId, conversationType: 'user', content: 'Budget 10%_ remaining' },
      { id: id(), conversationId, conversationType: 'ai', components: [{ id: 't', type: 'text', data: { content: 'Budget accepted' } }] },
      { id: id(), conversationId, conversationType: 'ai', content: 'secret Budget', components: [{ id: 't', type: 'text', data: { content: 'secret Budget', assetDeletedAt: 'now' } }] },
      { id: id(), conversationId, conversationType: 'ai', content: 'root = Card("secret Budget")' },
      { id: id(), conversationId: foreign, conversationType: 'user', content: 'Budget foreign' },
    ]);
    const result = await store.searchConversationMessages(conversationId, 'BUDGET', 1);
    expect(result.records).toHaveLength(1); expect(result.hasMore).toBe(true);
    expect((await store.searchConversationMessages(conversationId, 'budget', 20)).records).toHaveLength(2);
    expect((await store.searchConversationMessages(conversationId, '10%_', 20)).records).toHaveLength(1);
    expect((await store.searchConversationMessages(conversationId, 'secret', 20)).records).toHaveLength(0);
  });

  it('orders equal timestamps deterministically and includes the exact answer plus its prompt within a bounded window', async () => {
    const conversationId = await seed(), foreign = await seed(), createdAt = new Date('2026-01-01T00:00:00Z');
    const ids = [id(), id(), id(), id(), id()].sort();
    await database.db.insert(messages).values(ids.map((messageId, index) => ({ id: messageId, conversationId, createdAt,
      conversationType: index === 0 ? 'user' as const : 'ai' as const, questionMessageId: index ? ids[0] : null })));
    const result = await store.listAround(conversationId, ids[2], 3);
    expect(result?.records.map(row => row.id)).toEqual(ids.slice(0, 4));
    expect(result).toMatchObject({ hasOlder: true, hasNewer: true });
    expect((await store.listAround(conversationId, ids[2], 1))?.records.map(row => row.id)).toEqual([ids[0], ids[2]]);
    expect(await store.listAround(foreign, ids[2], 50)).toBeNull();
    expect((await store.findByIdInConversation(conversationId, ids[2]))?.id).toBe(ids[2]);
    expect(await store.findByIdInConversation(foreign, ids[2])).toBeNull();
  });
});
