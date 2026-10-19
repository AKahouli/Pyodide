import { randomBytes } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { conversations, messages } from '../../../postgres/schema';
import { PostgresMessageStore } from './postgres-message-store';

describeIntegration('conversation message authorization', () => {
  const database = makeTestDb();
  const store = new PostgresMessageStore(database.db);
  const id = () => randomBytes(12).toString('hex');
  const fixtures: string[] = [];
  afterEach(async () => {
    await database.db.delete(conversations).where(inArray(conversations.id, fixtures.splice(0)));
  });
  afterAll(database.close);

  it('bounds reads, branches and atomic writes to the conversation and message author', async () => {
    const a = id(), b = id(), owner = id(), other = id(), question = id(), answer = id(), stray = id();
    fixtures.push(a, b);
    await database.db.insert(conversations).values([{ id: a, createdBy: owner }, { id: b, createdBy: other }]);
    await database.db.insert(messages).values([
      { id: question, conversationId: b, senderId: other, conversationType: 'user', content: 'private' },
      { id: answer, conversationId: b, conversationType: 'ai', questionMessageId: question },
      { id: stray, conversationId: a, conversationType: 'ai', questionMessageId: question },
    ]);
    expect(await store.findByIdInConversation(a, question)).toBeNull();
    expect(await store.updateFeedback(answer, 'like', new Date(), a)).toBeNull();
    expect(await store.updateUser(question, { content: 'changed', editedAt: new Date() }, { conversationId: a, senderId: other })).toBeNull();
    expect(await store.updateUser(question, { content: 'changed', editedAt: new Date() }, { conversationId: b, senderId: owner })).toBeNull();
    expect((await store.findById(question))?.content).toBe('private');
    expect((await store.findBranchesByQuestion(question, b)).map((row) => row.id)).toEqual([answer]);
    expect(await store.updateFeedback(answer, 'like', new Date(), b)).toMatchObject({ feedback: 'like' });
    expect(await store.updateUser(question, { content: 'edited', editedAt: new Date() }, { conversationId: b, senderId: other })).toMatchObject({ content: 'edited' });
  });
});
