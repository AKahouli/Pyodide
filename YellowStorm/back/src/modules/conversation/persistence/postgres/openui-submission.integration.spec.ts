import { randomBytes } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { conversations, messages } from '../../../postgres/schema';
import { PostgresMessageStore } from './postgres-message-store';

describeIntegration('OpenUI typed interaction persistence', () => {
  const database = makeTestDb();
  const id = () => randomBytes(12).toString('hex');
  const fixtures: string[] = [];
  afterEach(async () => {
    if (fixtures.length) await database.db.delete(conversations).where(inArray(conversations.id, fixtures.splice(0)));
  });
  afterAll(database.close);
  it('reloads exact typed form JSON and keeps AI source lookup scoped between two users', async () => {
    const conversationId = id(), foreignConversation = id(), actor = id(), foreignActor = id(), source = id();
    fixtures.push(conversationId, foreignConversation);
    await database.db.insert(conversations).values([
      { id: conversationId, createdBy: actor }, { id: foreignConversation, createdBy: foreignActor },
    ]);
    await database.db.insert(messages).values({ id: source, conversationId, conversationType: 'ai',
      isComplete: true, isStreaming: false, components: [{ id: 'form', type: 'text', data: { content: 'root = Card([])' } }] });
    const interaction = { type: 'openui', schemaVersion: 1, sourceMessageId: source, componentId: 'form',
      actionType: 'continue_conversation', formName: 'settings', label: 'Continue',
      formState: { accepted: false, count: 0, ratio: 1.5, empty: '', optional: null,
        selected: ['a', false, 2], field: { componentType: 'Checkbox', value: false } }, params: {} };
    const saved = await new PostgresMessageStore(database.db).createUser({ conversationId, senderId: actor,
      content: `Continue\n\n${JSON.stringify(interaction)}`, requestId: 'openui-reload', interaction });
    const reloaded = new PostgresMessageStore(database.db);
    expect((await reloaded.findById(saved.id))?.interaction).toEqual(interaction);
    expect(await reloaded.findAiComponents(foreignConversation, source)).toBeNull();
    expect(await reloaded.findAiComponents(conversationId, source)).toMatchObject({ id: source });
    expect(await reloaded.findAiComponents(conversationId, saved.id)).toBeNull();
  });
});
