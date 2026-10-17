import { createHash, randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { conversations, messages, openUiAppStates, conversationGroupMembers } from '../../../postgres/schema';
import { PostgresMessageStore } from './postgres-message-store';

describeIntegration('OpenUI autosave typed state and atomic concurrency', () => {
  const database = makeTestDb();
  const store = new PostgresMessageStore(database.db);
  const id = () => randomBytes(12).toString('hex');
  const fixtures: string[] = [];
  const program = 'root = Card([MiniApp("draft", "App", "", [])])';
  const programDigest = createHash('sha256').update(program).digest('hex');
  const seed = async () => {
    const conversationId = id(), actorId = id(), sourceMessageId = id();
    fixtures.push(conversationId);
    await database.db.insert(conversations).values({ id: conversationId, createdBy: actorId });
    await database.db.insert(messages).values({ id: sourceMessageId, conversationId, conversationType: 'ai', isComplete: true,
      isStreaming: false, components: [{ id: 'text', type: 'text', data: { content: program } }] });
    return { actorId, conversationId, sourceMessageId, componentId: 'text', programDigest };
  };
  afterEach(async () => {
    if (fixtures.length) await database.db.delete(conversations).where(inArray(conversations.id, fixtures.splice(0)));
  });
  afterAll(database.close);
  it('persists exact types, isolates actors/apps and admits members only', async () => {
    const key = await seed(), otherActor = id();
    const state = { numeric: 0, enabled: false, blank: '', missing: null, fraction: 1.25, nested: { rows: ['a', 2, false] } };
    expect(await store.canWriteOpenUiAppState(key.conversationId, key.actorId)).toBe(true);
    expect(await store.canWriteOpenUiAppState(key.conversationId, otherActor)).toBe(false);
    await database.db.insert(conversationGroupMembers).values({ conversationId: key.conversationId, userId: otherActor, position: 0, status: 'member', joinedAt: new Date() });
    expect(await store.canWriteOpenUiAppState(key.conversationId, otherActor)).toBe(true);
    expect(await store.putOpenUiAppState(key, 0, state)).toMatchObject({ stateRevision: 1, state });
    expect((await new PostgresMessageStore(database.db).getOpenUiAppState(key))?.state).toEqual(state);
    expect(await store.getOpenUiAppState({ ...key, actorId: otherActor })).toBeNull();
    expect(await store.getOpenUiAppState({ ...key, componentId: 'other-app' })).toBeNull();
    expect(await store.putOpenUiAppState({ ...key, actorId: otherActor }, 0, { numeric: 100 })).toMatchObject({ stateRevision: 1 });
    expect((await store.getOpenUiAppState(key))?.state).toEqual(state);
  });
  it('allows exactly one concurrent create/update and refuses stale overwrites', async () => {
    const key = await seed();
    const creates = await Promise.all([store.putOpenUiAppState(key, 0, { value: 1 }), store.putOpenUiAppState(key, 0, { value: 2 })]);
    expect(creates.filter(Boolean)).toHaveLength(1);
    const writes = await Promise.all([store.putOpenUiAppState(key, 1, { value: 3 }), store.putOpenUiAppState(key, 1, { value: 4 })]);
    expect(writes.filter(Boolean)).toHaveLength(1);
    expect(await store.putOpenUiAppState(key, 1, { value: 'stale' })).toBeNull();
    expect(await store.getOpenUiAppState(key)).toMatchObject({ stateRevision: 2, state: writes.find(Boolean)!.state });
  });
  it('saves different apps concurrently for one actor and reloads their typed drafts independently', async () => {
    const first = await seed();
    const secondProgram = 'root = Card([MiniApp("summary", "Summarizer", "", [])])';
    const second = { ...first, componentId: 'summary',
      programDigest: createHash('sha256').update(secondProgram).digest('hex') };
    await database.db.update(messages).set({ components: [
      { id: first.componentId, type: 'text', data: { content: program } },
      { id: second.componentId, type: 'text', data: { content: secondProgram } },
    ] }).where(eq(messages.id, first.sourceMessageId));
    const firstState = { celsius: 0, enabled: false, optional: null };
    const secondState = { source: 'Launch Monday.', length: 'detailed', bullets: false, blank: '' };
    const results = await Promise.all([
      store.putOpenUiAppState(first, 0, firstState),
      store.putOpenUiAppState(second, 0, secondState),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ stateRevision: 1, state: firstState }),
      expect.objectContaining({ stateRevision: 1, state: secondState }),
    ]);
    const reloaded = new PostgresMessageStore(database.db);
    expect((await reloaded.getOpenUiAppState(first))?.state).toEqual(firstState);
    expect((await reloaded.getOpenUiAppState(second))?.state).toEqual(secondState);
    expect(await store.putOpenUiAppState(first, 0, { celsius: 999 })).toBeNull();
    expect(await reloaded.getOpenUiAppState(second)).toMatchObject({ stateRevision: 1, state: secondState });
  });
  it('fences changed programs and cascades message/conversation deletion', async () => {
    const key = await seed();
    await store.putOpenUiAppState(key, 0, { value: 0 });
    await database.db.update(messages).set({ components: [{ id: 'text', type: 'text', data: { content: 'root = Card([])' } }] }).where(eq(messages.id, key.sourceMessageId));
    expect(await store.putOpenUiAppState(key, 1, { value: 2 })).toBeNull();
    await database.db.delete(messages).where(eq(messages.id, key.sourceMessageId));
    expect(await store.getOpenUiAppState(key)).toBeNull();
    const second = await seed();
    await store.putOpenUiAppState(second, 0, { value: false });
    await database.db.delete(conversations).where(eq(conversations.id, second.conversationId));
    expect(await database.db.select().from(openUiAppStates).where(eq(openUiAppStates.conversationId, second.conversationId))).toEqual([]);
  });
});
