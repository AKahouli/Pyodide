import { BadRequestException } from '../../exceptions';
import { RootWorkService } from './root-work.service';
import { RootWorkStore } from './root-work.store';
import { RootEvidenceRecord, RootExecutionRecord, newStopRequestId } from './root-work.types';

/** In-memory fake standing in for the postgres store (unit-scope only). */
class FakeRootWorkStore implements RootWorkStore {
  executions = new Map<string, RootExecutionRecord>();
  evidence = new Map<string, RootEvidenceRecord>();
  conversations = new Map<string, { epoch: number; lastStopRequestId: string | null }>();

  async registerExecution(
    input: Parameters<RootWorkStore['registerExecution']>[0],
  ): Promise<RootExecutionRecord> {
    const existing = this.executions.get(input.executionId);
    if (existing) return existing;
    const now = new Date();
    const record: RootExecutionRecord = {
      id: input.executionId,
      conversationId: input.conversationId,
      rootAgentId: input.rootAgentId,
      workGroupId: input.workGroupId,
      parentExecutionId: input.parentExecutionId,
      role: input.role,
      depth: input.depth,
      attempt: input.attempt,
      status: 'running',
      conversationEpoch: input.conversationEpoch,
      stopRequestId: null,
      resultPayload: null,
      createdAt: now,
      updatedAt: now,
      terminalAt: null,
    };
    this.executions.set(record.id, record);
    return record;
  }

  async getExecution(executionId: string): Promise<RootExecutionRecord | null> {
    return this.executions.get(executionId) ?? null;
  }

  async completeExecution(
    executionId: string,
    status: 'completed' | 'cancelled' | 'failed' | 'outcome_unknown',
    result: RootExecutionRecord['resultPayload'],
  ): Promise<RootExecutionRecord | null> {
    const record = this.executions.get(executionId);
    if (!record || !['running', 'waiting', 'cancellation_requested'].includes(record.status)) {
      return null;
    }
    record.status = status;
    record.resultPayload = result;
    record.terminalAt = new Date();
    return record;
  }

  async markWaiting(executionId: string): Promise<void> {
    const record = this.executions.get(executionId);
    if (record && record.status === 'running') record.status = 'waiting';
  }

  async registerEvidence(
    input: Parameters<RootWorkStore['registerEvidence']>[0],
  ): Promise<RootEvidenceRecord> {
    const existing = this.evidence.get(input.dedupKey);
    if (existing) return existing;
    const record: RootEvidenceRecord = {
      id: input.evidenceId,
      executionId: input.executionId,
      conversationId: input.conversationId,
      kind: input.kind,
      producerAgentId: input.producerAgentId,
      payload: input.payload,
      dedupKey: input.dedupKey,
      createdAt: new Date(),
    };
    this.evidence.set(record.dedupKey, record);
    return record;
  }

  async listEvidenceForExecution(executionId: string): Promise<RootEvidenceRecord[]> {
    return [...this.evidence.values()].filter((e) => e.executionId === executionId);
  }

  async stopRootWork(
    input: Parameters<RootWorkStore['stopRootWork']>[0],
  ): Promise<{ barrierEpoch: number; applied: boolean; markedCount: number }> {
    const conversation = this.conversations.get(input.conversationId);
    if (!conversation) throw new Error('conversation missing');
    // Mirrors the real store's UUIDv7 ordering fence: equal id = replay;
    // smaller (older) id after a newer one is stale and ignored.
    if (
      conversation.lastStopRequestId !== null &&
      conversation.lastStopRequestId >= input.stopRequestId
    ) {
      return { barrierEpoch: conversation.epoch, applied: false, markedCount: 0 };
    }
    let markedCount = 0;
    for (const record of this.executions.values()) {
      if (
        record.conversationId === input.conversationId &&
        record.conversationEpoch <= conversation.epoch &&
        ['running', 'waiting'].includes(record.status)
      ) {
        record.status = 'cancellation_requested';
        record.stopRequestId = input.stopRequestId;
        markedCount += 1;
      }
    }
    conversation.epoch += 1;
    conversation.lastStopRequestId = input.stopRequestId;
    return { barrierEpoch: conversation.epoch, applied: true, markedCount };
  }
}

const CONVERSATION_ID = 'a'.repeat(24);
const EXECUTION_ID = 'b'.repeat(24);
const AGENT_ID = 'c'.repeat(24);

function makeService() {
  const store = new FakeRootWorkStore();
  store.conversations.set(CONVERSATION_ID, { epoch: 2, lastStopRequestId: null });
  return { service: new RootWorkService(store), store };
}

describe('RootWorkService', () => {
  it('registers a valid execution and returns the record', async () => {
    const { service } = makeService();
    const record = await service.registerExecution({
      executionId: EXECUTION_ID,
      conversationId: CONVERSATION_ID,
      rootAgentId: AGENT_ID,
      workGroupId: 'd'.repeat(24),
      parentExecutionId: null,
      role: 'root',
      depth: 0,
      attempt: 1,
      conversationEpoch: 2,
    });
    expect(record.status).toBe('running');
    expect(record.role).toBe('root');
  });

  it('rejects malformed ids and unknown roles at the trust boundary', async () => {
    const { service } = makeService();
    await expect(
      service.registerExecution({
        executionId: 'not-hex',
        conversationId: CONVERSATION_ID,
        rootAgentId: null,
        workGroupId: null,
        parentExecutionId: null,
        role: 'root',
        depth: 0,
        attempt: 1,
        conversationEpoch: 2,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.registerExecution({
        executionId: EXECUTION_ID,
        conversationId: CONVERSATION_ID,
        rootAgentId: null,
        workGroupId: null,
        parentExecutionId: null,
        role: 'wizard' as never,
        depth: 0,
        attempt: 1,
        conversationEpoch: 2,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('is idempotent on execution id (replay returns the same record)', async () => {
    const { service } = makeService();
    const input = {
      executionId: EXECUTION_ID,
      conversationId: CONVERSATION_ID,
      rootAgentId: null,
      workGroupId: null,
      parentExecutionId: null,
      role: 'library_worker' as const,
      depth: 1,
      attempt: 1,
      conversationEpoch: 2,
    };
    const first = await service.registerExecution(input);
    const second = await service.registerExecution(input);
    expect(second).toEqual(first);
  });

  it('registers evidence idempotently by dedup key and reuses the original id', async () => {
    const { service } = makeService();
    await service.registerExecution({
      executionId: EXECUTION_ID,
      conversationId: CONVERSATION_ID,
      rootAgentId: null,
      workGroupId: null,
      parentExecutionId: null,
      role: 'library_worker',
      depth: 1,
      attempt: 1,
      conversationEpoch: 2,
    });
    const base = {
      executionId: EXECUTION_ID,
      conversationId: CONVERSATION_ID,
      kind: 'citation' as const,
      producerAgentId: AGENT_ID,
      payload: { url: 'https://example.test/doc' },
      nativeIdentity: 'call_abc',
      outputOrdinal: 0,
    };
    const first = await service.registerEvidence(base);
    const replay = await service.registerEvidence({ ...base, payload: { url: 'https://other.test' } });
    expect(replay.id).toBe(first.id);
    expect(replay.payload.url).toBe('https://example.test/doc');
    expect((await service.listEvidenceForExecution(EXECUTION_ID)).length).toBe(1);
  });

  it('stopRootWork marks nonterminal executions at or before the epoch and bumps it', async () => {
    const { service } = makeService();
    await service.registerExecution({
      executionId: EXECUTION_ID,
      conversationId: CONVERSATION_ID,
      rootAgentId: null,
      workGroupId: null,
      parentExecutionId: null,
      role: 'root',
      depth: 0,
      attempt: 1,
      conversationEpoch: 2,
    });
    const result = await service.stopRootWork({ conversationId: CONVERSATION_ID, stopRequestId: newStopRequestId() });
    expect(result).toMatchObject({ applied: true, barrierEpoch: 3, markedCount: 1 });
    const record = await service.getExecution(EXECUTION_ID);
    expect(record?.status).toBe('cancellation_requested');
  });

  it('retries the same stop request id are no-ops; execution completed before Stop stays completed', async () => {
    const { service } = makeService();
    await service.registerExecution({
      executionId: EXECUTION_ID,
      conversationId: CONVERSATION_ID,
      rootAgentId: null,
      workGroupId: null,
      parentExecutionId: null,
      role: 'root',
      depth: 0,
      attempt: 1,
      conversationEpoch: 2,
    });
    await service.completeExecution(EXECUTION_ID, 'completed', null);
    const stopRequestId = newStopRequestId();
    const first = await service.stopRootWork({ conversationId: CONVERSATION_ID, stopRequestId });
    expect(first.markedCount).toBe(0);
    const replay = await service.stopRootWork({ conversationId: CONVERSATION_ID, stopRequestId });
    expect(replay).toMatchObject({ applied: false, markedCount: 0 });
    const record = await service.getExecution(EXECUTION_ID);
    expect(record?.status).toBe('completed');
  });

  it('rejects a malformed stop request id', async () => {
    const { service } = makeService();
    await expect(
      service.stopRootWork({ conversationId: CONVERSATION_ID, stopRequestId: 'not-a-uuid' }),
    ).rejects.toThrow(BadRequestException);
    // v4 ids are rejected too: the fence needs the time-ordered format.
    await expect(
      service.stopRootWork({ conversationId: CONVERSATION_ID, stopRequestId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('a different OLDER stop id arriving after a newer one is ignored (no epoch churn)', async () => {
    const { service } = makeService();
    await service.registerExecution({
      executionId: EXECUTION_ID,
      conversationId: CONVERSATION_ID,
      rootAgentId: null,
      workGroupId: null,
      parentExecutionId: null,
      role: 'root',
      depth: 0,
      attempt: 1,
      conversationEpoch: 2,
    });
    await service.stopRootWork({ conversationId: CONVERSATION_ID, stopRequestId: newStopRequestId() });
    const epochAfterFirst = (await service.getExecution(EXECUTION_ID))?.conversationEpoch ?? 0;
    // A v7 id that sorts BEFORE the anchored one: build one with a past timestamp.
    const staleId = '00000000-0000-7000-8000-000000000000';
    const stale = await service.stopRootWork({ conversationId: CONVERSATION_ID, stopRequestId: staleId });
    expect(stale).toMatchObject({ applied: false, markedCount: 0 });
    // A genuinely NEW stop still applies and marks the (still nonterminal) execution.
    const fresh = await service.stopRootWork({ conversationId: CONVERSATION_ID, stopRequestId: newStopRequestId() });
    expect(fresh.applied).toBe(true);
    const record = await service.getExecution(EXECUTION_ID);
    expect(record?.status).toBe('cancellation_requested');
    expect(epochAfterFirst).toBe(2);
  });

  it('newStopRequestId generates time-ordered v7 ids', () => {
    const first = newStopRequestId();
    const second = newStopRequestId();
    expect(second > first).toBe(true);
  });
});
