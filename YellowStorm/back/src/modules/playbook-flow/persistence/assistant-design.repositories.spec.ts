import { and, eq, inArray, sql } from 'drizzle-orm';
import { isForeignKeyViolation, isUniqueViolation, newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PlaybookAssistantAttachmentRepository } from './assistant-attachment.repository';
import { PlaybookAssistantMessageRepository } from './assistant-message.repository';
import { PlaybookAssistantOperationRepository, type PlaybookAssistantOperationKey } from './assistant-operation.repository';
import { PlaybookAssistantRequestRepository, type NewPlaybookAssistantRequest } from './assistant-request.repository';
import { PlaybookAssistantRevisionRepository } from './assistant-revision.repository';
import { PlaybookDesignMessageRepository } from './design-message.repository';
import { PlaybookDesignOperationRepository } from './design-operation.repository';

describeIntegration('playbook assistant and design repositories (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const requests = new PlaybookAssistantRequestRepository(db as never);
  const operations = new PlaybookAssistantOperationRepository(db as never);
  const revisions = new PlaybookAssistantRevisionRepository(db as never);
  const messages = new PlaybookAssistantMessageRepository(db as never);
  const attachments = new PlaybookAssistantAttachmentRepository(db as never);
  const designMessages = new PlaybookDesignMessageRepository(db as never);
  const designOperations = new PlaybookDesignOperationRepository(db as never);

  const ownerId = oid();
  const otherId = oid();
  // The assistant tables key owners by plain strings: every row of this suite carries one of these.
  const assistantOwners = [ownerId, otherId];
  const later = (ms = 60 * 60 * 1000) => new Date(Date.now() + ms);
  // Well clear of any skew between this clock and the database's now().
  const past = () => new Date(Date.now() - 60 * 60 * 1000);
  const uid = (prefix: string) => `${prefix}-${oid()}`;

  const newFlow = async (owner = ownerId): Promise<string> => {
    const id = oid();
    await db.insert(schema.playbookFlows).values({ id, ownerId: owner, name: `flow ${id}` });
    return id;
  };

  beforeAll(async () => {
    for (const id of [ownerId, otherId]) {
      await db.insert(schema.identityUsers).values({ id, email: `pbc-${id.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    }
  });

  afterAll(async () => {
    await db.delete(schema.playbookAssistantRequests).where(inArray(schema.playbookAssistantRequests.ownerId, assistantOwners));
    await db.delete(schema.playbookAssistantOperations).where(inArray(schema.playbookAssistantOperations.ownerId, assistantOwners));
    await db.delete(schema.playbookAssistantRevisions).where(inArray(schema.playbookAssistantRevisions.ownerId, assistantOwners));
    await db.delete(schema.playbookAssistantMessages).where(inArray(schema.playbookAssistantMessages.ownerId, assistantOwners));
    await db.delete(schema.playbookAssistantAttachments).where(inArray(schema.playbookAssistantAttachments.ownerId, assistantOwners));
    // Users cascade to their flows, and flows to their design messages and operations.
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId, otherId]));
    await close();
  });

  // ---------------------------------------------------------------- requests

  describe('assistant requests', () => {
    const newRequest = (overrides: Partial<NewPlaybookAssistantRequest> = {}): NewPlaybookAssistantRequest => ({
      requestId: uid('request'),
      ownerId,
      agentId: 'agent-1',
      conversationId: uid('conversation'),
      correlationId: uid('correlation'),
      operationKind: 'existing_construction',
      playbookId: 'playbook-1',
      expectedDefinitionRevision: 3,
      contextId: uid('context'),
      messageHash: 'hash-1',
      originalText: 'Add scoring',
      selectedTaskId: null,
      executionId: null,
      attachmentIds: ['attachment-1'],
      expiresAt: later(),
      ...overrides,
    });
    const expire = (requestId: string) =>
      db.update(schema.playbookAssistantRequests).set({ expiresAt: past() }).where(eq(schema.playbookAssistantRequests.requestId, requestId));

    it('creates a processing request with the documented defaults and reads it back', async () => {
      const input = newRequest({ originalText: 'Add\u0000 scoring', requestedName: 'Lead\u0000 pipeline' });
      const created = await requests.insert(input);
      expect(created).toMatchObject({
        requestId: input.requestId,
        status: 'processing',
        assessmentVersion: 0,
        answers: [],
        assessment: null,
        continuationId: null,
        mutationOperationId: null,
        workspaceDefaultIds: [],
        attachmentIds: ['attachment-1'],
        originalText: 'Add scoring',
        requestedName: 'Lead pipeline',
      });
      expect(await requests.findByRequestId(input.requestId)).toMatchObject({ id: created!.id });
      expect(await requests.findByRequestId(input.requestId, otherId)).toBeNull();
      expect(await requests.conversationExists(ownerId, input.conversationId, 'playbook-1')).toBe(true);
      expect(await requests.conversationExists(ownerId, input.conversationId, 'playbook-2')).toBe(false);
      expect(await requests.conversationExists(ownerId, input.conversationId)).toBe(true);
    });

    it('lets exactly one concurrent insert claim a request id', async () => {
      const input = newRequest();
      const results = await Promise.all(Array.from({ length: 5 }, () => requests.insert({ ...input, messageHash: uid('hash') })));
      expect(results.filter((row) => row !== null)).toHaveLength(1);
      const rows = await db.select().from(schema.playbookAssistantRequests).where(eq(schema.playbookAssistantRequests.requestId, input.requestId));
      expect(rows).toHaveLength(1);
    });

    it('hides an expired request and lets a new request take over its id', async () => {
      const input = newRequest({ operationKind: 'generation' });
      const first = await requests.insert(input);
      await requests.claimAssessment(input.requestId);
      await expire(input.requestId);

      expect(await requests.findByRequestId(input.requestId)).toBeNull();
      expect(await requests.findFirstByRequestIds([input.requestId])).toBeNull();
      expect(await requests.conversationExists(ownerId, input.conversationId)).toBe(false);
      expect(await requests.claimAssessment(input.requestId)).toBeNull();

      const replaced = await requests.insert({ ...input, messageHash: 'hash-2', originalText: 'Another turn' });
      expect(replaced).toMatchObject({ id: first!.id, messageHash: 'hash-2', originalText: 'Another turn', assessmentVersion: 0, status: 'processing' });
      expect(replaced!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('finds the first live request among a current and a legacy key', async () => {
      const legacy = await requests.insert(newRequest());
      const current = newRequest();
      expect(await requests.findFirstByRequestIds([current.requestId, legacy!.requestId])).toMatchObject({ id: legacy!.id });
      expect(await requests.findFirstByRequestIds([])).toBeNull();
    });

    it('hands out one assessment version per claim and saves only the latest attempt', async () => {
      const input = newRequest();
      await requests.insert(input);
      const versions = await Promise.all([requests.claimAssessment(input.requestId), requests.claimAssessment(input.requestId)]);
      expect([...versions].sort()).toEqual([1, 2]);

      expect(await requests.saveAssessment(input.requestId, 1, { assessment: { status: 'x' }, continuationId: null, status: 'ready', expiresAt: later() })).toBeNull();
      const saves = await Promise.all([2, 2].map((version, i) => requests.saveAssessment(input.requestId, version, {
        assessment: { status: 'needs_clarification', n: i, text: 'a\u0000b' },
        continuationId: `continuation-${i}-${input.requestId}`,
        status: 'awaiting_clarification',
        expiresAt: later(),
      })));
      const winners = saves.filter((row) => row !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]).toMatchObject({ status: 'awaiting_clarification', assessment: expect.objectContaining({ text: 'ab' }) });
      expect(await requests.claimAssessment(input.requestId)).toBeNull();
    });

    it('lets one bound actor consume a clarification, and puts it back only before construction', async () => {
      const input = newRequest();
      await requests.insert(input);
      const version = (await requests.claimAssessment(input.requestId))!;
      const continuationId = uid('continuation');
      await requests.saveAssessment(input.requestId, version, { assessment: { status: 'needs_clarification' }, continuationId, status: 'awaiting_clarification', expiresAt: later() });

      expect(await requests.findAwaitingContinuation(continuationId, ownerId)).toMatchObject({ requestId: input.requestId });
      expect(await requests.findContinuation(continuationId, ownerId, 'playbook-1', input.conversationId)).toMatchObject({ requestId: input.requestId });
      expect(await requests.rebindCorrelation({ continuationId, playbookId: 'playbook-1', ownerId, agentId: 'agent-1', conversationId: input.conversationId }, 'correlation-2')).toBe(true);
      expect(await requests.rebindCorrelation({ continuationId, ownerId, agentId: 'agent-2', conversationId: input.conversationId }, 'correlation-3')).toBe(false);

      const actor = { ownerId, agentId: 'agent-1', conversationId: input.conversationId, correlationId: 'correlation-2' };
      expect(await requests.claimContinuation({ requestId: input.requestId, continuationId, ...actor, correlationId: 'stale' }, { answers: [], assessment: {} })).toBe(false);
      const claims = await Promise.all([0, 1].map((i) => requests.claimContinuation(
        { requestId: input.requestId, continuationId, ...actor },
        { answers: [{ questionId: 'q', choice: `answer-${i}` }], assessment: { status: 'ready_to_construct' } },
      )));
      expect(claims.filter(Boolean)).toHaveLength(1);
      const ready = await requests.findByRequestId(input.requestId);
      expect(ready).toMatchObject({ status: 'ready', continuationId: null, assessment: { status: 'ready_to_construct' } });
      expect(ready!.answers).toHaveLength(1);

      // The request is ready, not processing: nothing to restore.
      await requests.restoreContinuation(input.requestId, continuationId);
      expect((await requests.findByRequestId(input.requestId))!.status).toBe('ready');
    });

    it('restores a consumed clarification while no construction was claimed', async () => {
      const input = newRequest();
      await requests.insert(input);
      await requests.restoreContinuation(input.requestId, 'continuation-restored');
      expect(await requests.findByRequestId(input.requestId)).toMatchObject({ status: 'awaiting_clarification', continuationId: 'continuation-restored' });

      const claimed = newRequest();
      await requests.insert(claimed);
      await requests.claimMutation(claimed.requestId, 'operation-1');
      await requests.restoreContinuation(claimed.requestId, 'continuation-restored');
      expect(await requests.findByRequestId(claimed.requestId)).toMatchObject({ status: 'processing', continuationId: null });
    });

    it('binds one construction per request, resets and releases only that one', async () => {
      const input = newRequest({ operationKind: 'generation', playbookId: null, expectedDefinitionRevision: null });
      await requests.insert(input);
      const claims = await Promise.all(['operation-a', 'operation-b', 'operation-c'].map((op) => requests.claimMutation(input.requestId, op)));
      expect(claims.filter(Boolean)).toHaveLength(1);
      const holder = (await requests.findByRequestId(input.requestId))!.mutationOperationId!;

      await requests.bindGeneratedPlaybook(input.requestId, 'playbook-9', 1);
      expect(await requests.findByRequestId(input.requestId)).toMatchObject({ playbookId: 'playbook-9', expectedDefinitionRevision: 1 });
      expect(await requests.resetMutation(input.requestId, 'operation-other')).toBe(false);
      expect(await requests.resetMutation(input.requestId, holder)).toBe(true);
      expect(await requests.findByRequestId(input.requestId)).toMatchObject({ mutationOperationId: null, playbookId: null, expectedDefinitionRevision: null, status: 'ready' });

      await requests.claimMutation(input.requestId, 'operation-d');
      await requests.releaseMutation(input.requestId, 'operation-other');
      expect((await requests.findByRequestId(input.requestId))!.mutationOperationId).toBe('operation-d');
      await requests.releaseMutation(input.requestId, 'operation-d');
      expect((await requests.findByRequestId(input.requestId))!.mutationOperationId).toBeNull();
    });

    it('binds a generated playbook only to a generation request', async () => {
      const input = newRequest();
      await requests.insert(input);
      await requests.bindGeneratedPlaybook(input.requestId, 'playbook-9', 1);
      expect(await requests.findByRequestId(input.requestId)).toMatchObject({ playbookId: 'playbook-1', expectedDefinitionRevision: 3 });
    });

    it('completes a request but keeps a pending clarification waiting', async () => {
      const done = newRequest();
      await requests.insert(done);
      await requests.complete(done.requestId, 'Answer\u0000', 'operation-1', { kind: 'answer', text: 'x\u0000y' });
      expect(await requests.findByRequestId(done.requestId)).toMatchObject({
        status: 'completed', assistantAnswer: 'Answer', mutationOperationId: 'operation-1', responsePayload: { kind: 'answer', text: 'xy' },
      });

      const waiting = newRequest();
      await requests.insert(waiting);
      await requests.restoreContinuation(waiting.requestId, 'continuation-w');
      await requests.complete(waiting.requestId, 'Which region?');
      expect(await requests.findByRequestId(waiting.requestId)).toMatchObject({ status: 'awaiting_clarification', assistantAnswer: 'Which region?', mutationOperationId: null });

      await requests.markFailed(waiting.requestId);
      expect((await requests.findByRequestId(waiting.requestId))!.status).toBe('failed');
    });
  });

  // ---------------------------------------------------------------- operations

  describe('assistant operations', () => {
    const newOperation = async (overrides: Partial<Parameters<PlaybookAssistantOperationRepository['insert']>[0]> = {}): Promise<PlaybookAssistantOperationKey> => {
      const key = { operationId: uid('operation'), playbookId: 'playbook-1', ownerId };
      await operations.insert({
        ...key,
        baseDefinitionRevision: 4,
        origin: 'designer',
        target: 'canonical',
        applyTarget: 'current_playbook',
        requestId: null,
        operationKind: 'construction',
        createdPlaybookId: null,
        workerId: 'worker-1',
        leaseExpiresAt: later(),
        expiresAt: later(),
        ...overrides,
      });
      return key;
    };
    const append = (key: PlaybookAssistantOperationKey, expectedSequence: number, overrides: Partial<Parameters<PlaybookAssistantOperationRepository['appendEvent']>[1]> = {}) =>
      operations.appendEvent(key, {
        expectedSequence,
        event: { type: 'progress', sequence: expectedSequence + 1 },
        eventBytes: 10,
        status: null,
        terminal: false,
        leaseExpiresAt: later(),
        expiresAt: later(),
        workerId: 'worker-1',
        ...overrides,
      });

    it('creates a queued, pending operation and finds it only by its full key', async () => {
      const key = await newOperation();
      expect(await operations.find(key)).toMatchObject({
        ...key, status: 'queued', disposition: 'pending', lastSequence: 0, events: [], eventBytes: 0, committedRevision: null,
      });
      expect(await operations.find({ ...key, ownerId: otherId })).toBeNull();
      expect(await operations.find({ ...key, playbookId: 'playbook-2' })).toBeNull();
      const duplicate = await newOperation({ operationId: key.operationId }).catch((error: unknown) => error);
      expect(isUniqueViolation(duplicate, 'uq_playbook_assistant_operations_operation')).toBe(true);
    });

    it('appends each sequence number exactly once under concurrency', async () => {
      const key = await newOperation();
      const results = await Promise.all(Array.from({ length: 4 }, (_, i) => append(key, 0, { event: { type: 'progress', sequence: 1, n: i }, eventBytes: 7 })));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await append(key, 1, { status: 'running' })).toBe(true);
      const operation = await operations.find(key);
      expect(operation).toMatchObject({ lastSequence: 2, eventBytes: 17, status: 'running' });
      expect(operation!.events.map((event) => event.sequence)).toEqual([1, 2]);
    });

    it('accepts events only from the leased worker, except a cancellation, and nothing after a terminal event', async () => {
      const key = await newOperation();
      expect(await append(key, 0, { workerId: 'worker-2' })).toBe(false);
      await db.update(schema.playbookAssistantOperations).set({ leaseExpiresAt: past() }).where(eq(schema.playbookAssistantOperations.operationId, key.operationId));
      expect(await append(key, 0)).toBe(false);
      expect(await append(key, 0, {
        workerId: undefined, event: { type: 'cancelled', text: 'stop\u0000ped' }, status: 'cancelled', terminal: true, leaseExpiresAt: null,
      })).toBe(true);
      const cancelled = await operations.find(key);
      expect(cancelled).toMatchObject({ status: 'cancelled', leaseExpiresAt: null, lastSequence: 1 });
      expect(cancelled!.terminalAt).toBeInstanceOf(Date);
      expect(cancelled!.events[0]).toEqual({ type: 'cancelled', text: 'stopped' });
      expect(await append(key, 1, { workerId: undefined })).toBe(false);
    });

    it('fails an orphaned operation once, even when two recoveries race', async () => {
      const key = await newOperation({ leaseExpiresAt: past() });
      const live = await newOperation();
      const cutoff = new Date();
      const orphaned = await operations.findOrphaned(cutoff);
      expect(orphaned).toContainEqual({ ...key, lastSequence: 0 });
      expect(orphaned.map((row) => row.operationId)).not.toContain(live.operationId);

      const input = { expectedSequence: 0, cutoff, event: { type: 'failed', message: 'Construction worker lease expired' }, eventBytes: 50, expiresAt: later() };
      const results = await Promise.all([operations.failOrphaned(key, input), operations.failOrphaned(key, input)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await operations.find(key)).toMatchObject({ status: 'failed', lastSequence: 1, eventBytes: 50, leaseExpiresAt: null });
      expect(await operations.failOrphaned(live, input)).toBe(false);
    });

    it('renews the lease of its worker from the database clock, never a lost one', async () => {
      const key = await newOperation({ leaseExpiresAt: later(1000) });
      expect(await operations.renewLease(key, 'worker-2', 300_000, 86_400_000)).toBe(false);
      expect(await operations.renewLease(key, 'worker-1', 300_000, 86_400_000)).toBe(true);
      const [clock] = await db.execute<{ now: Date }>(sql`SELECT now() AS now`).then((r) => r.rows);
      const renewed = (await operations.find(key))!;
      expect(Math.abs(renewed.leaseExpiresAt!.getTime() - new Date(clock.now).getTime() - 300_000)).toBeLessThan(5_000);
      expect(Math.abs(renewed.expiresAt.getTime() - new Date(clock.now).getTime() - 86_400_000)).toBeLessThan(5_000);

      await db.update(schema.playbookAssistantOperations).set({ leaseExpiresAt: past() }).where(eq(schema.playbookAssistantOperations.operationId, key.operationId));
      expect(await operations.renewLease(key, 'worker-1', 300_000, 86_400_000)).toBe(false);
    });

    it('lets exactly one caller claim the apply of a completed operation, and records its result once', async () => {
      const key = await newOperation({ target: 'advisor_preview', applyTarget: 'new_playbook' });
      expect(await operations.claimApply(key, later())).toBe(false);
      await append(key, 0, { status: 'completed', terminal: true, leaseExpiresAt: null });

      const claims = await Promise.all([operations.claimApply(key, later()), operations.claimApply(key, later()), operations.claimApply(key, later())]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(await operations.releaseApply(key, later())).toBe(true);
      expect((await operations.find(key))!.disposition).toBe('pending');
      expect(await operations.claimApply(key, later())).toBe(true);

      const records = await Promise.all([
        operations.recordCreatedPlaybook(key, { createdPlaybookId: 'playbook-new', committedRevision: 1, expiresAt: later() }),
        operations.recordCreatedPlaybook(key, { createdPlaybookId: 'playbook-new', committedRevision: 1, expiresAt: later() }),
      ]);
      expect(records.filter(Boolean)).toHaveLength(1);
      expect(await operations.find(key)).toMatchObject({ disposition: 'applied', createdPlaybookId: 'playbook-new', committedRevision: 1 });
      expect(await operations.discard(key, later())).toBe(false);
    });

    it('commits in the expected status, reverts from the committed revision only once, and discards pending previews', async () => {
      const key = await newOperation();
      await append(key, 0, { status: 'completed', terminal: true, leaseExpiresAt: null });
      expect(await operations.markApplied(key, { status: 'failed', committedRevision: 5, expiresAt: later() })).toBe(false);
      expect(await operations.markApplied(key, { status: 'completed', committedRevision: 5, expiresAt: later() })).toBe(true);
      const applied = (await operations.find(key))!;
      expect(applied).toMatchObject({ disposition: 'applied', committedRevision: 5 });
      expect(applied.committedAt).toBeInstanceOf(Date);

      expect(await operations.markReverted(key, { revertedRevision: 6, committedRevision: 4, expiresAt: later() })).toBe(false);
      const reverts = await Promise.all([
        operations.markReverted(key, { revertedRevision: 6, committedRevision: 5, expiresAt: later() }),
        operations.markReverted(key, { revertedRevision: 7, committedRevision: 5, expiresAt: later() }),
      ]);
      expect(reverts.filter(Boolean)).toHaveLength(1);
      expect(await operations.find(key)).toMatchObject({ disposition: 'reverted' });

      const preview = await newOperation({ target: 'advisor_preview' });
      expect(await operations.discard(preview, later())).toBe(true);
      expect(await operations.discard(preview, later())).toBe(true);
      expect((await operations.find(preview))!.disposition).toBe('discarded');
    });

    it('hides an expired operation from every read and write', async () => {
      const key = await newOperation({ leaseExpiresAt: past(), expiresAt: past() });
      expect(await operations.find(key)).toBeNull();
      expect((await operations.findOrphaned(new Date())).map((row) => row.operationId)).not.toContain(key.operationId);
      expect(await operations.appendEvent(key, { expectedSequence: 0, event: {}, eventBytes: 1, status: null, terminal: false, leaseExpiresAt: null, expiresAt: later() })).toBe(false);
    });
  });

  // ---------------------------------------------------------------- revisions

  describe('assistant revisions', () => {
    const key = () => ({ operationId: uid('operation'), playbookId: 'playbook-1', ownerId });

    it('captures the snapshot once, even when two commits race, and keeps extending its retention', async () => {
      const k = key();
      await Promise.all([
        revisions.captureOnce({ ...k, definitionRevision: 4, definition: { name: 'First\u0000', nodes: [{ id: 'n' }] }, expiresAt: later(1000) }),
        revisions.captureOnce({ ...k, definitionRevision: 4, definition: { name: 'First\u0000', nodes: [{ id: 'n' }] }, expiresAt: later(1000) }),
      ]);
      await revisions.captureOnce({ ...k, definitionRevision: 9, definition: { name: 'Second' }, expiresAt: later() });
      const snapshot = await revisions.find(k);
      expect(snapshot).toMatchObject({ definitionRevision: 4, definition: { name: 'First', nodes: [{ id: 'n' }] } });
      expect(snapshot!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60 * 1000);
      expect(await revisions.find({ ...k, ownerId: otherId })).toBeNull();
    });

    it('replaces an expired snapshot as if the sweep had removed it', async () => {
      const k = key();
      await revisions.captureOnce({ ...k, definitionRevision: 1, definition: { name: 'Old' }, expiresAt: later() });
      await db.update(schema.playbookAssistantRevisions).set({ expiresAt: past() }).where(eq(schema.playbookAssistantRevisions.operationId, k.operationId));
      expect(await revisions.find(k)).toBeNull();

      await revisions.captureOnce({ ...k, playbookId: 'playbook-2', definitionRevision: 2, definition: { name: 'New' }, expiresAt: later() });
      expect(await revisions.find({ ...k, playbookId: 'playbook-2' })).toMatchObject({ definitionRevision: 2, definition: { name: 'New' } });
    });
  });

  // ---------------------------------------------------------------- messages

  describe('assistant messages', () => {
    const message = (requestId: string, conversationId: string, role: 'user' | 'assistant', content: string) => ({
      messageId: uid('message'), requestId, conversationId, ownerId, playbookId: 'playbook-1', role, content, operationId: null, expiresAt: later(),
    });

    it('keeps the first message per request and role, under concurrency too', async () => {
      const requestId = uid('request');
      const conversationId = uid('conversation');
      await Promise.all([
        messages.appendOnce(message(requestId, conversationId, 'user', 'First')),
        messages.appendOnce(message(requestId, conversationId, 'user', 'Second')),
      ]);
      await messages.appendOnce(message(requestId, conversationId, 'user', 'Third'));
      const rows = await messages.listConversation(ownerId, 'playbook-1', conversationId);
      expect(rows).toHaveLength(1);
      expect(['First', 'Second']).toContain(rows[0].content);
    });

    it('lists a conversation oldest first and finds the latest conversation, ignoring expired messages', async () => {
      const older = uid('conversation');
      const newer = uid('conversation');
      const r1 = uid('request');
      await messages.appendOnce(message(r1, older, 'user', 'Q1\u0000'));
      await messages.appendOnce(message(r1, older, 'assistant', 'A1'));
      const r2 = uid('request');
      await messages.appendOnce({ ...message(r2, newer, 'user', 'Q2'), playbookId: 'playbook-latest' });

      expect((await messages.listConversation(ownerId, 'playbook-1', older)).map((row) => [row.role, row.content])).toEqual([['user', 'Q1'], ['assistant', 'A1']]);
      expect(await messages.latestConversationId(ownerId, 'playbook-latest')).toBe(newer);
      expect(await messages.latestConversationId(otherId, 'playbook-latest')).toBeNull();

      await db.update(schema.playbookAssistantMessages).set({ expiresAt: past() }).where(eq(schema.playbookAssistantMessages.requestId, r2));
      expect(await messages.latestConversationId(ownerId, 'playbook-latest')).toBeNull();
      // An expired message no longer holds its request and role.
      await messages.appendOnce({ ...message(r2, newer, 'user', 'Q2 again'), playbookId: 'playbook-latest' });
      expect((await messages.listConversation(ownerId, 'playbook-latest', newer)).map((row) => row.content)).toEqual(['Q2 again']);
    });
  });

  // ---------------------------------------------------------------- attachments

  describe('assistant attachments', () => {
    const attachment = (requestId: string, overrides: Record<string, unknown> = {}) => ({
      attachmentId: uid('attachment'), requestId, ownerId, playbookId: 'playbook-1', expectedDefinitionRevision: 3,
      objectKey: `playbook-assistant/${ownerId}/${oid()}.png`, mediaType: 'image/png', declaredSize: 8, expiresAt: later(), ...overrides,
    });

    it('counts, confirms and binds attachments of one request', async () => {
      const requestId = uid('request');
      const a = await attachments.insert(attachment(requestId));
      const b = await attachments.insert(attachment(requestId));
      await attachments.insert(attachment(requestId, { expiresAt: past() }));
      expect(a.status).toBe('pending');
      expect(await attachments.countLiveForRequest(ownerId, requestId)).toBe(2);
      expect(await attachments.findOwned(a.attachmentId, ownerId, 'playbook-1')).toMatchObject({ attachmentId: a.attachmentId, declaredSize: 8 });
      expect(await attachments.findOwned(a.attachmentId, otherId, 'playbook-1')).toBeNull();

      await attachments.confirm(a.attachmentId, ownerId, 'playbook-1', { actualSize: 8, contentSha256: 'sha' });
      await attachments.confirm(b.attachmentId, otherId, 'playbook-1', { actualSize: 8, contentSha256: 'sha' });
      const binding = { attachmentIds: [a.attachmentId, b.attachmentId], ownerId, playbookId: 'playbook-1', requestId, expectedDefinitionRevision: 3 };
      expect(await attachments.countConfirmedBindings(binding)).toBe(1);
      expect(await attachments.countConfirmedBindings({ ...binding, expectedDefinitionRevision: 4 })).toBe(0);
      expect((await attachments.findByAttachmentIds([a.attachmentId]))[0]).toMatchObject({ status: 'confirmed', actualSize: 8, contentSha256: 'sha' });
    });

    it('lists expired attachments for cleanup and deletes them by id', async () => {
      const expired = await attachments.insert(attachment(uid('request'), { expiresAt: new Date(Date.now() - 10 * 365 * 24 * 3600 * 1000) }));
      expect((await attachments.listExpired(1000)).map((row) => row.attachmentId)).toContain(expired.attachmentId);
      await attachments.deleteByAttachmentIds([expired.attachmentId]);
      expect(await attachments.findByAttachmentIds([expired.attachmentId])).toEqual([]);
    });

    it('refuses a duplicate attachment id and a non-positive size', async () => {
      const first = await attachments.insert(attachment(uid('request')));
      const duplicate = await attachments.insert(attachment(uid('request'), { attachmentId: first.attachmentId })).catch((error: unknown) => error);
      expect(isUniqueViolation(duplicate, 'uq_playbook_assistant_attachments_attachment')).toBe(true);
      await expect(attachments.insert(attachment(uid('request'), { declaredSize: 0 }))).rejects.toThrow();
      await attachments.deleteByAttachmentId(first.attachmentId);
      expect(await attachments.findByAttachmentIds([first.attachmentId])).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- design messages

  describe('design messages', () => {
    const snapshot = { nodes: [{ id: 'n1', label: 'Step\u0000' }], controlEdges: [], dataBindings: [] };

    it('creates, lists newest first, finds and clears the messages of one user on one flow', async () => {
      const flowId = await newFlow();
      const first = await designMessages.create({ flowId, createdBy: ownerId, userQuery: 'Add a step\u0000', aiSummary: 'Added', snapshotBefore: snapshot, status: 'completed' });
      const second = await designMessages.create({ flowId, createdBy: ownerId, userQuery: 'Fail', aiSummary: '', snapshotBefore: snapshot, status: 'failed', error: 'boom' });
      await designMessages.create({ flowId, createdBy: otherId, userQuery: 'Theirs', aiSummary: '', snapshotBefore: snapshot, status: 'completed' });

      expect(first).toMatchObject({ flowId, createdBy: ownerId, userQuery: 'Add a step', status: 'completed', error: null, revertedFromMessageId: null });
      expect(first.snapshotBefore).toEqual({ nodes: [{ id: 'n1', label: 'Step' }], controlEdges: [], dataBindings: [] });
      expect((await designMessages.listForUser(flowId, ownerId)).map((m) => m.id)).toEqual([second.id, first.id]);
      expect(await designMessages.findForUser(first.id, flowId, ownerId)).toMatchObject({ id: first.id });
      expect(await designMessages.findForUser(first.id, flowId, otherId)).toBeNull();
      expect(await designMessages.findForUser('bad', flowId, ownerId)).toBeNull();
      expect(await designMessages.listForUser('bad', ownerId)).toEqual([]);

      expect(await designMessages.deleteForUser(flowId, ownerId)).toBe(2);
      expect(await designMessages.listForUser(flowId, ownerId)).toEqual([]);
      expect(await designMessages.listForUser(flowId, otherId)).toHaveLength(1);
    });

    it('keeps a revert when the message it reverted is cleared, and goes with its flow', async () => {
      const flowId = await newFlow();
      const original = await designMessages.create({ flowId, createdBy: otherId, userQuery: 'q', aiSummary: 's', snapshotBefore: snapshot, status: 'completed' });
      const revert = await designMessages.create({
        flowId, createdBy: ownerId, userQuery: `Reverted to snapshot from ${original.id}`, aiSummary: 'r', snapshotBefore: snapshot, status: 'reverted', revertedFromMessageId: original.id,
      });
      expect(revert.revertedFromMessageId).toBe(original.id);
      await designMessages.deleteForUser(flowId, otherId);
      expect(await designMessages.findForUser(revert.id, flowId, ownerId)).toMatchObject({ revertedFromMessageId: null });

      await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.id, flowId));
      expect(await designMessages.findForUser(revert.id, flowId, ownerId)).toBeNull();
    });

    it('rejects a message on a flow that does not exist', async () => {
      const error = await designMessages.create({ flowId: oid(), createdBy: ownerId, userQuery: 'q', aiSummary: '', snapshotBefore: snapshot, status: 'completed' }).catch((e: unknown) => e);
      expect(isForeignKeyViolation(error)).toBe(true);
      await expect(designMessages.create({ flowId: 'bad', createdBy: ownerId, userQuery: 'q', aiSummary: '', snapshotBefore: snapshot, status: 'completed' })).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------- design operations

  describe('design operations', () => {
    const snapshot = { nodes: [], controlEdges: [], dataBindings: [], updatedAt: null };
    const mine = (flowIds: string[]) => db.select().from(schema.playbookDesignOperations).where(inArray(schema.playbookDesignOperations.flowId, flowIds));

    it('returns the operation already queued under an idempotency key, also under concurrency', async () => {
      const flowId = await newFlow();
      const [a, b] = await Promise.all([
        designOperations.enqueue({ ownerId, flowId, query: 'add review', idempotencyKey: 'key-1', snapshotBefore: snapshot }),
        designOperations.enqueue({ ownerId, flowId, query: 'add review again', idempotencyKey: 'key-1', snapshotBefore: snapshot }),
      ]);
      expect(a.id).toBe(b.id);
      const again = await designOperations.enqueue({ ownerId, flowId, query: 'third', idempotencyKey: 'key-1', snapshotBefore: snapshot });
      expect(again).toMatchObject({ id: a.id, status: 'queued', lockVersion: 0 });
      expect(['add review', 'add review again']).toContain(again.query);
      const unkeyed = await Promise.all([
        designOperations.enqueue({ ownerId, flowId, query: 'x', snapshotBefore: snapshot }),
        designOperations.enqueue({ ownerId, flowId, query: 'y', snapshotBefore: snapshot }),
      ]);
      expect(new Set(unkeyed.map((op) => op.id)).size).toBe(2);
      expect(unkeyed[0].idempotencyKey).toBeNull();
      expect(await mine([flowId])).toHaveLength(3);
      await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.id, flowId));
    });

    it('rejects an operation on a flow that does not exist', async () => {
      const error = await designOperations.enqueue({ ownerId, flowId: oid(), query: 'q', snapshotBefore: snapshot }).catch((e: unknown) => e);
      expect(isForeignKeyViolation(error)).toBe(true);
    });

    it('finds and cancels an operation of its owner only while queued', async () => {
      const flowId = await newFlow();
      const op = await designOperations.enqueue({ ownerId, flowId, query: 'q', snapshotBefore: snapshot });
      expect(await designOperations.findForOwner(op.id, otherId, flowId)).toBeNull();
      expect(await designOperations.findForOwner('bad', ownerId, flowId)).toBeNull();
      expect(await designOperations.cancelQueued(op.id, otherId, flowId)).toBeNull();
      const cancelled = await designOperations.cancelQueued(op.id, ownerId, flowId);
      expect(cancelled).toMatchObject({ status: 'cancelled' });
      expect(cancelled!.completedAt).toBeInstanceOf(Date);
      expect(await designOperations.cancelQueued(op.id, ownerId, flowId)).toBeNull();
      await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.id, flowId));
    });

    it('never starts two writers on one flow, nor more than the user limit, when claims race', async () => {
      const flowA = await newFlow();
      const flowB = await newFlow();
      const flowC = await newFlow(otherId);
      for (const flowId of [flowA, flowA, flowB]) await designOperations.enqueue({ ownerId, flowId, query: 'q', snapshotBefore: snapshot });
      await designOperations.enqueue({ ownerId: otherId, flowId: flowC, query: 'q', snapshotBefore: snapshot });

      const claimed = (await Promise.all(Array.from({ length: 6 }, () => designOperations.claimNext(1)))).filter((op) => op !== null);
      const ours = claimed.filter((op) => [flowA, flowB, flowC].includes(op!.flowId));
      expect(new Set(claimed.map((op) => op!.id)).size).toBe(claimed.length);
      expect(ours.every((op) => op!.status === 'running' && op!.lockVersion === 1 && op!.startedAt instanceof Date)).toBe(true);

      const running = (await mine([flowA, flowB, flowC])).filter((op) => op.status === 'running');
      // One per owner (limit 1), so at most one of flow A / flow B, and the other owner's flow C.
      expect(running.filter((op) => op.ownerId === ownerId).length).toBeLessThanOrEqual(1);
      expect(running.filter((op) => op.flowId === flowA).length).toBeLessThanOrEqual(1);
      expect(running.map((op) => op.ownerId).sort()).toEqual([ownerId, otherId].sort());
      expect(await designOperations.countActive()).toBeGreaterThanOrEqual(2);
      await db.delete(schema.playbookFlows).where(inArray(schema.playbookFlows.id, [flowA, flowB, flowC]));
    });

    it('lets only the run holding the claimed lock version move the operation on', async () => {
      const flowId = await newFlow();
      const op = await designOperations.enqueue({ ownerId, flowId, query: 'q', snapshotBefore: snapshot });
      await db.update(schema.playbookDesignOperations).set({ status: 'running', lockVersion: 1 }).where(eq(schema.playbookDesignOperations.id, op.id));
      const message = await designMessages.create({ flowId, createdBy: ownerId, userQuery: 'q', aiSummary: 's', snapshotBefore: { nodes: [], controlEdges: [], dataBindings: [] }, status: 'completed' });

      expect(await designOperations.markApplying(op.id, 0)).toBe(false);
      expect(await designOperations.markApplying(op.id, 1)).toBe(true);
      expect(await designOperations.markApplying(op.id, 1)).toBe(false);
      expect(await designOperations.finish(op.id, 0, { status: 'failed', error: 'stale' })).toBe(false);
      expect(await designOperations.finish(op.id, 1, { status: 'completed', resultPreview: { flowId }, appliedMessageId: message.id })).toBe(true);
      const done = await designOperations.findById(op.id);
      expect(done).toMatchObject({ status: 'completed', resultPreview: { flowId }, appliedMessageId: message.id, error: null });
      expect(done!.completedAt).toBeInstanceOf(Date);

      // Clearing the design history detaches the operation from its message.
      await designMessages.deleteForUser(flowId, ownerId);
      expect((await designOperations.findById(op.id))!.appliedMessageId).toBeNull();

      const failed = await designOperations.enqueue({ ownerId, flowId, query: 'q2', snapshotBefore: snapshot });
      await db.update(schema.playbookDesignOperations).set({ status: 'applying', lockVersion: 3 }).where(and(eq(schema.playbookDesignOperations.id, failed.id)));
      expect(await designOperations.finish(failed.id, 3, { status: 'failed', error: 'gRPC\u0000 down' })).toBe(true);
      expect(await designOperations.findById(failed.id)).toMatchObject({ status: 'failed', error: 'gRPC down' });
      await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.id, flowId));
      expect(await designOperations.findById(failed.id)).toBeNull();
    });

    it('completes a run whose design message was cleared meanwhile, without the link', async () => {
      const flowId = await newFlow();
      const op = await designOperations.enqueue({ ownerId, flowId, query: 'q', snapshotBefore: snapshot });
      await db.update(schema.playbookDesignOperations).set({ status: 'applying', lockVersion: 1 }).where(eq(schema.playbookDesignOperations.id, op.id));
      expect(await designOperations.finish(op.id, 1, { status: 'completed', resultPreview: { flowId }, appliedMessageId: oid() })).toBe(true);
      expect(await designOperations.findById(op.id)).toMatchObject({ status: 'completed', appliedMessageId: null });
      await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.id, flowId));
    });
  });
});
