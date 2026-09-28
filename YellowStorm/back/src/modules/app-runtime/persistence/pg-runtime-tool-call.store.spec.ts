import { eq, inArray } from 'drizzle-orm';
import { isForeignKeyViolation, newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgRuntimeToolCallStore } from './pg-runtime-tool-call.store';

describeIntegration('PgRuntimeToolCallStore (integration)', () => {
  const { db, close } = makeTestDb();
  const store = new PgRuntimeToolCallStore(db as never);
  const toolCallIds: string[] = [];
  // Tool calls hang off a binding (foreign key, cascade), which belongs to a user.
  const userId = newObjectId();
  const stamp = Date.now().toString(36);
  const bindingId = `arb_spec_${stamp}`;
  const workspaceId = `ws_spec_${stamp}`;

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: userId, email: `ar-${userId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    await db.insert(schema.appRuntimeBindings).values({ bindingId, workspaceId, conversationSessionId: 'session-spec', userId, mcpTokenHash: 'hash' });
  });

  const start = async (suffix: string): Promise<string> => {
    const toolCallId = `tc_spec_${suffix}_${Date.now().toString(36)}`;
    toolCallIds.push(toolCallId);
    await store.upsertRunning({
      toolCallId,
      bindingId,
      workspaceId,
      tool: 'read_file',
      argumentsHash: 'hash',
      baseRevisionId: null,
    });
    return toolCallId;
  };

  afterAll(async () => {
    if (toolCallIds.length) {
      await db.delete(schema.appRuntimeToolCalls).where(inArray(schema.appRuntimeToolCalls.toolCallId, toolCallIds));
    }
    await db.delete(schema.appRuntimeBindings).where(eq(schema.appRuntimeBindings.bindingId, bindingId));
    await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, userId));
    await close();
  });

  it('refuses a tool call for a binding that does not exist, and goes away with its binding', async () => {
    const orphan = await store
      .upsertRunning({ toolCallId: `tc_spec_orphan_${stamp}`, bindingId: `arb_missing_${stamp}`, workspaceId, tool: 'read_file', argumentsHash: 'hash', baseRevisionId: null })
      .catch((e: unknown) => e);
    expect(isForeignKeyViolation(orphan)).toBe(true);

    const ownBinding = `arb_spec_own_${stamp}`;
    await db.insert(schema.appRuntimeBindings).values({ bindingId: ownBinding, workspaceId: `ws_spec_own_${stamp}`, conversationSessionId: 'session-spec', userId, mcpTokenHash: 'hash' });
    const toolCallId = `tc_spec_cascade_${stamp}`;
    await store.upsertRunning({ toolCallId, bindingId: ownBinding, workspaceId: `ws_spec_own_${stamp}`, tool: 'read_file', argumentsHash: 'hash', baseRevisionId: null });
    expect(await store.findByToolCallId(toolCallId)).not.toBeNull();

    await db.delete(schema.appRuntimeBindings).where(eq(schema.appRuntimeBindings.bindingId, ownBinding));
    expect(await store.findByToolCallId(toolCallId)).toBeNull();
  });

  it('markSucceeded strips U+0000 from the result, which jsonb would otherwise reject', async () => {
    const toolCallId = await start('ok');

    await store.markSucceeded(toolCallId, { output: 'bin\u0000ary', files: [{ 'na\u0000me': 'a\u0000.bin' }] }, null, 5);

    const record = await store.findByToolCallId(toolCallId);
    expect(record?.status).toBe('succeeded');
    expect(record?.result).toEqual({ output: 'binary', files: [{ name: 'a.bin' }] });
  });

  it('markFailed strips U+0000 from the error', async () => {
    const toolCallId = await start('fail');

    await store.markFailed(toolCallId, { message: 'boom\u0000!' }, 7);

    const record = await store.findByToolCallId(toolCallId);
    expect(record?.status).toBe('failed');
    expect(record?.error).toEqual({ message: 'boom!' });
  });
});
