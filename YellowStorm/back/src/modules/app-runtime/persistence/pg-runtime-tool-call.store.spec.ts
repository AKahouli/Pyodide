import { inArray } from 'drizzle-orm';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgRuntimeToolCallStore } from './pg-runtime-tool-call.store';

describeIntegration('PgRuntimeToolCallStore (integration)', () => {
  const { db, close } = makeTestDb();
  const store = new PgRuntimeToolCallStore(db as never);
  const toolCallIds: string[] = [];

  const start = async (suffix: string): Promise<string> => {
    const toolCallId = `tc_spec_${suffix}_${Date.now().toString(36)}`;
    toolCallIds.push(toolCallId);
    await store.upsertRunning({
      toolCallId,
      bindingId: 'binding-spec',
      workspaceId: 'workspace-spec',
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
    await close();
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
