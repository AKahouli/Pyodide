import { eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import * as u from '../../../scripts/migrate/2026-10-worky.units';
import type { Row, WorkyRefs } from '../../../scripts/migrate/2026-10-worky.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';

/**
 * The dev worky data is small, has no plan-delta-linked messages, no reservations and no cost events,
 * so the backfill would leave most of the mapping unexercised. This drives the same mapping,
 * validation and insert with fabricated Mongo-shaped documents and checks every migrated row reads
 * back identical (numerics and bigints read as float8, exactly as the runner's checksum does).
 */
describeIntegration('worky backfill mapping (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const oid = (): string => newObjectId();
  const at = (iso: string): Date => new Date(iso);
  const objectId = (hex: string): Types.ObjectId => new Types.ObjectId(hex);

  const ownerId = oid();
  const sharedUserId = oid();
  const goneUserId = oid(); // never inserted
  const streamId = oid();
  const taskId = oid();
  const goneStreamId = oid();
  const goneTaskId = oid();

  const refs = (over: Partial<Record<keyof WorkyRefs, string[]>> = {}): WorkyRefs => ({
    users: new Set(over.users ?? [ownerId, sharedUserId]),
    streams: new Set(over.streams ?? [streamId]),
    tasks: new Set(over.tasks ?? [taskId]),
    messages: new Set(over.messages ?? []),
    deltas: new Set(over.deltas ?? []),
    policies: new Set(over.policies ?? []),
    workers: new Set(over.workers ?? []),
    proposals: new Set(over.proposals ?? []),
  });

  const stamp = { createdAt: at('2026-03-01T09:00:00Z'), updatedAt: at('2026-03-01T09:30:00Z') };

  beforeAll(async () => {
    for (const id of [ownerId, sharedUserId]) {
      await db.insert(schema.identityUsers).values({ id, email: `wk-bf-${id.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    }
  });

  afterAll(async () => {
    await db.delete(schema.workyStreams).where(eq(schema.workyStreams.ownerUserId, ownerId));
    await db.delete(schema.workyMemoryProposals).where(eq(schema.workyMemoryProposals.ownerUserId, ownerId));
    await db.delete(schema.workyMailSubscriptions).where(eq(schema.workyMailSubscriptions.userId, ownerId));
    await db.delete(schema.workyAuditEvents).where(eq(schema.workyAuditEvents.streamId, goneStreamId));
    await db.delete(schema.workyElectricCursors).where(eq(schema.workyElectricCursors.shape, `bf-${ownerId}`));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId, sharedUserId]));
    await close();
  });

  const readBack = async (table: string, columns: string[], key: string, id: unknown): Promise<Row> => {
    const back = await pool.query(`SELECT ${u.checksumSelect(columns)} FROM ${table} WHERE ${key} = $1`, [id]);
    expect(back.rows).toHaveLength(1);
    return back.rows[0] as Row;
  };
  const sameContent = (row: Row, back: Row, key = 'id') => { expect(compareRowChecksums(new Map([[String(row[key]), row]]), new Map([[String(row[key]), back]]))).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 }); };
  const roundTrip = async (table: string, columns: string[], row: Row, key = 'id'): Promise<void> => {
    await u.insertRow(pool, table, columns, row, key);
    sameContent(row, await readBack(table, columns, key, row[key]), key);
  };

  const streamDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: objectId(streamId), ownerUserId: objectId(ownerId), workspaceId: objectId(ownerId), title: 'Quarterly review', status: 'planning', controlState: 'active',
    schedulerEnabled: false, currentPlanVersion: 2, executionPlanVersion: null, artifactWorkspaceId: null, managerAgentId: null, managerModelId: 'gpt-x', workerModelId: null,
    voicePrompt: null, aiSessionId: `session-${oid()}`, governancePolicyRef: null, activeDurationMinutes: 12.5, lastActivityAt: at('2026-03-01T10:00:00Z'), startedAt: null, completedAt: null,
    budget: { limitUsd: 12.5, limitTokens: 100000, spendUsd: 0.42, tokensUsed: 18500, enforcement: 'notify' }, shares: [], ...stamp, ...over,
  });

  describe('streams', () => {
    it('maps the nested budget and reads back identical, numerics included', async () => {
      const row = u.buildStream(streamDoc());
      expect(row).toMatchObject({ budget_limit_usd: 12.5, budget_spend_usd: 0.42, budget_tokens_used: 18500, budget_enforcement: 'notify', active_duration_minutes: 12.5 });
      expect(u.validateStream(row, refs())).toBeNull();
      await u.insertStream(pool, row, refs());
      sameContent(row, await readBack('worky.streams', u.STREAM_COLUMNS, 'id', row.id));
    });

    it('inserts the shares with the stream, dropping duplicates, unknown users and bad permissions', async () => {
      const shareId = oid();
      const id = oid();
      const doc = streamDoc({
        _id: objectId(id),
        aiSessionId: null,
        shares: [
          { _id: objectId(shareId), userId: objectId(sharedUserId), permission: 'write', ...stamp },
          { _id: new Types.ObjectId(), userId: objectId(sharedUserId), permission: 'read', ...stamp }, // same user twice
          { _id: new Types.ObjectId(), userId: objectId(goneUserId), permission: 'read', ...stamp }, // user gone
          { _id: new Types.ObjectId(), userId: objectId(ownerId), permission: 'owner', ...stamp }, // not a permission
        ],
      });
      const row = u.buildStream(doc);
      expect(Object.keys(row)).not.toContain('shares');
      expect(u.streamShares(row)).toHaveLength(3);
      await u.insertStream(pool, row, refs({ streams: [id] }));
      const shares = await pool.query('SELECT id, user_id, permission FROM worky.stream_shares WHERE stream_id = $1', [id]);
      expect(shares.rows).toEqual([{ id: shareId, user_id: sharedUserId, permission: 'write' }]);
    });

    it('nulls a policy reference that points nowhere, and rejects what the model cannot hold', async () => {
      const id = oid();
      const withPolicy = u.buildStream(streamDoc({ _id: objectId(id), aiSessionId: null, governancePolicyRef: new Types.ObjectId() }));
      await u.insertStream(pool, withPolicy, refs({ streams: [id] }));
      expect((await readBack('worky.streams', ['governance_policy_ref'], 'id', id)).governance_policy_ref).toBeNull();

      const verdict = (over: Record<string, unknown>) => u.validateStream(u.buildStream(streamDoc(over)), refs());
      expect(verdict({ ownerUserId: objectId(goneUserId) })).toMatch(/dangling owner_user_id/);
      expect(verdict({ title: '' })).toMatch(/title length 0/);
      expect(verdict({ title: 'x'.repeat(201) })).toMatch(/title length 201/);
      expect(verdict({ status: 'exploded' })).toMatch(/status 'exploded'/);
      expect(verdict({ controlState: 'sideways' })).toMatch(/control_state/);
      expect(verdict({ budget: { enforcement: 'strict' } })).toMatch(/budget_enforcement/);
      expect(() => u.buildStream(streamDoc({ ownerUserId: 'nope' }))).toThrow(BackfillError);
    });

    it('clamps negative counters and tolerates a stream without a budget', () => {
      const row = u.buildStream(streamDoc({ budget: undefined, currentPlanVersion: -3, activeDurationMinutes: -1 }));
      expect(row).toMatchObject({ budget_limit_usd: 0, budget_tokens_used: 0, budget_enforcement: 'hard_stop', current_plan_version: 0, active_duration_minutes: 0 });
    });
  });

  describe('tasks', () => {
    const taskDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: objectId(taskId), streamId: objectId(streamId), externalId: 'step-1', ordinal: 3, title: 'Analyse', description: 'x'.repeat(7061), lane: 'blocked',
      planningStatus: 'pending', executionState: 'waiting_for_event', controlState: 'active', priority: 'medium', assigneeType: 'unassigned', assigneeId: null,
      dependsOn: [], requiredTools: [], actionCategory: 'internal_analysis', acceptanceCriteria: [], budget: { estimateUsd: 0.25, actualUsd: 0.1, tokensEstimate: 500, tokensActual: 120 },
      waitConditions: [], wave: 1, dependsOnStepIds: ['step-0'], assigneeKey: 'analyst', kind: null, question: null, blockedReason: 'waiting for a reply', result: 'r'.repeat(62757),
      isPersona: false, isDynamicDelegate: true, agentKey: 'legacy', durationMs: 1500, ...stamp, ...over,
    });

    it('maps a manager step, drops the legacy fields and reads back identical', async () => {
      const row = u.buildTask(taskDoc());
      expect(row).toMatchObject({ kind: 'execute', wave: 1, depends_on_step_ids: ['step-0'], is_dynamic_delegate: true, budget_tokens_estimate: 500 });
      expect(Object.keys(row)).not.toContain('agent_key');
      expect(u.validateTask(row, refs())).toBeNull();
      await roundTrip('worky.tasks', u.TASK_COLUMNS, row);
      expect((await readBack('worky.tasks', ['description', 'result'], 'id', row.id)).description).toHaveLength(7061);
    });

    it('maps a plan-delta task with its dependencies and human assignee', async () => {
      const id = oid();
      const row = u.buildTask(taskDoc({
        _id: objectId(id), externalId: null, ordinal: null, wave: null, dependsOnStepIds: undefined, dependsOn: [objectId(taskId)], requiredTools: ['search'],
        acceptanceCriteria: ['done'], assigneeType: 'human_agent', assigneeId: objectId(sharedUserId), theoreticalDeadlineAt: at('2026-04-01T00:00:00Z'), durationMs: null, kind: 'ask',
      }));
      await roundTrip('worky.tasks', u.TASK_COLUMNS, row);
      expect(row).toMatchObject({ depends_on: [taskId], external_id: null, duration_ms: null });
    });

    it('reports a stream id stored as a string, which no query ever matched', () => {
      expect(() => u.buildTask(taskDoc({ streamId: streamId }))).toThrow(/stored as a string/);
      expect(() => u.buildMessage({ _id: new Types.ObjectId(), streamId, role: 'owner', content: 'x' })).toThrow(/stored as a string/);
    });

    it('rejects a task of a missing stream or with a value the model does not know, and nulls a gone assignee', async () => {
      const verdict = (over: Record<string, unknown>) => u.validateTask(u.buildTask(taskDoc(over)), refs());
      expect(verdict({ streamId: objectId(goneStreamId) })).toMatch(/dangling stream_id/);
      expect(verdict({ lane: 'sideways' })).toMatch(/lane 'sideways'/);
      expect(verdict({ actionCategory: 'teleport' })).toMatch(/action_category/);
      expect(verdict({ title: '' })).toMatch(/title is empty/);

      const id = oid();
      const row = u.buildTask(taskDoc({ _id: objectId(id), externalId: 'step-2', assigneeId: objectId(goneUserId), assigneeType: 'human_agent' }));
      const fixed = { ...row, assignee_id: refs().users.has(String(row.assignee_id)) ? row.assignee_id : null };
      await roundTrip('worky.tasks', u.TASK_COLUMNS, fixed);
    });

    it('refuses the second task with the same step id in a stream, without swallowing it', async () => {
      const twin = u.buildTask(taskDoc({ _id: new Types.ObjectId() }));
      await expect(u.insertRow(pool, 'worky.tasks', u.TASK_COLUMNS, twin)).rejects.toThrow(/uq_worky_tasks_external/);
    });
  });

  describe('messages and the plan history', () => {
    it('maps a message, keeps only the voice origin and nulls a reference to a gone delta', async () => {
      const id = oid();
      const doc = { _id: objectId(id), streamId: objectId(streamId), externalId: 'm-1', turnId: 't-1', role: 'manager', content: 'a\u0000b', planDeltaRef: new Types.ObjectId(), emittedAt: at('2026-03-01T09:10:00Z'), origin: 'whatsapp', whatsappDelivery: { x: 1 }, ...stamp };
      const row = u.buildMessage(doc);
      expect(row).toMatchObject({ content: 'ab', origin: null });
      expect(u.validateMessage(row, refs())).toBeNull();
      const fixed = u.withLiveDelta(row, refs());
      expect(fixed.plan_delta_ref).toBeNull();
      await roundTrip('worky.messages', u.MESSAGE_COLUMNS, fixed);
      expect(u.buildMessage({ ...doc, origin: 'voice' }).origin).toBe('voice');
      expect(u.validateMessage(u.buildMessage({ ...doc, role: 'robot' }), refs())).toMatch(/role 'robot'/);
    });

    it('maps a delta and a version, nulling a version\'s gone message', async () => {
      const deltaId = oid();
      const delta = u.buildDelta({
        _id: objectId(deltaId), streamId: objectId(streamId), basePlanVersion: 0, resultPlanVersion: 1, phase: 'planning', triggerEventId: 'ev', status: 'applied', applyMode: 'auto',
        reason: '', createdBy: objectId(ownerId), body: { create_tasks: [{ title: 'a' }], update_tasks: [] }, ...stamp,
      });
      expect(delta.applied_at).toEqual(stamp.updatedAt);
      expect(u.validateDelta(delta, refs())).toBeNull();
      await roundTrip('worky.plan_deltas', u.DELTA_COLUMNS, delta);
      expect(u.validateDelta(u.buildDelta({ ...delta, _id: new Types.ObjectId(), streamId: objectId(streamId), createdBy: objectId(ownerId), phase: 'bogus' }), refs())).toMatch(/phase/);

      const version = u.buildVersion({ _id: new Types.ObjectId(), streamId: objectId(streamId), versionNumber: 1, phase: 'planning', createdBy: objectId(ownerId), createdFromMessageId: new Types.ObjectId(), triggerEventId: 'ev', summary: '+1 task', ...stamp });
      expect(u.validateVersion(version, refs())).toBeNull();
      const fixed = u.withLiveMessage(version, refs());
      expect(fixed.created_from_message_id).toBeNull();
      await roundTrip('worky.plan_versions', u.VERSION_COLUMNS, fixed);
      expect(u.validateVersion(u.buildVersion({ _id: new Types.ObjectId(), streamId: objectId(streamId), versionNumber: 0, phase: 'planning', createdBy: objectId(ownerId), ...stamp }), refs())).toMatch(/below 1/);
    });

    it('maps the projection, the components and the artifacts that the Electric consumer mirrored', async () => {
      const projection = u.buildProjection({ _id: new Types.ObjectId(), streamId: objectId(streamId), title: 'Plan', goal: 'win', status: 'running', sessionStatus: null, activeInterruptId: 'i-1', ...stamp });
      await roundTrip('worky.plan_projections', u.PROJECTION_COLUMNS, projection);
      const component = u.buildMessageComponent({ _id: new Types.ObjectId(), streamId: objectId(streamId), externalId: 'c-1', messageExternalId: 'm-1', ordinal: 1, type: 'choice', data: { options: ['a\u0000'] }, ...stamp });
      expect(component.data).toEqual({ options: ['a'] });
      await roundTrip('worky.message_components', u.MESSAGE_COMPONENT_COLUMNS, component);
      const stepComponent = u.buildStepComponent({ _id: new Types.ObjectId(), streamId: objectId(streamId), externalId: 'sc-1', stepExternalId: 'step-1', type: 'toolActivity', data: [1, 2], ...stamp });
      expect(stepComponent).toMatchObject({ data: {}, ordinal: 0 });
      await roundTrip('worky.plan_step_components', u.STEP_COMPONENT_COLUMNS, stepComponent);
      const artifact = u.buildStepArtifact({ _id: new Types.ObjectId(), streamId: objectId(streamId), externalId: 'a-1', stepExternalId: 'step-1', filePath: 'p/a.csv', filename: 'a.csv', artifactKind: 'data', mimeType: null, size: 12, ...stamp });
      await roundTrip('worky.plan_step_artifacts', u.STEP_ARTIFACT_COLUMNS, artifact);
      for (const row of [projection, component, stepComponent, artifact]) expect(u.validateInStream(row, refs())).toBeNull();
      expect(u.validateInStream({ ...projection, stream_id: goneStreamId }, refs())).toMatch(/dangling stream_id/);
    });

    it('maps an interaction, nulling a gone task and a gone target user', async () => {
      const row = u.buildInteraction({
        _id: new Types.ObjectId(), streamId: objectId(streamId), taskId: objectId(goneTaskId), type: 'clarification', targetUserId: objectId(goneUserId), question: 'which?', options: ['a', 'b'],
        status: 'pending', blockingScope: 'task', blocksTaskIds: [objectId(taskId), 'junk'], respondedAt: null, response: null, metadata: { planDeltaId: 'x' }, ...stamp,
      });
      expect(row.blocks_task_ids).toEqual([taskId]);
      expect(u.validateInteraction(row, refs())).toBeNull();
      const fixed = u.withLiveInteractionRefs(row, refs());
      expect(fixed).toMatchObject({ task_id: null, target_user_id: null });
      await roundTrip('worky.interactions', u.INTERACTION_COLUMNS, fixed);
      expect(u.validateInteraction(u.buildInteraction({ _id: new Types.ObjectId(), streamId: objectId(streamId), type: 'gossip', question: 'q', ...stamp }), refs())).toMatch(/type 'gossip'/);
    });
  });

  describe('execution, budget and mail rows', () => {
    it('maps workers, results, traces, reservations and cost events with their task and stream references', async () => {
      const workerId = oid();
      const worker = u.buildWorker({ _id: objectId(workerId), streamId: objectId(streamId), taskId: objectId(taskId), agentEntityId: new Types.ObjectId(), role: 'analyst', status: 'running', adkSessionId: null, adkInvocationId: null, lastCheckpointAt: null, ...stamp });
      expect(u.validateWorker(worker, refs())).toBeNull();
      await roundTrip('worky.ephemeral_workers', u.WORKER_COLUMNS, worker);

      const result = u.buildResult({ _id: new Types.ObjectId(), taskId: objectId(taskId), version: 1, status: 'done', summary: 's', payload: { output: 'x' }, contentArtifactId: null, createdByWorkerId: new Types.ObjectId(), ...stamp });
      expect(u.validateResult(result, refs())).toBeNull();
      const liveResult = u.withLiveWorker(result, refs({ workers: [workerId] }));
      expect(liveResult.created_by_worker_id).toBeNull();
      await roundTrip('worky.task_results', u.RESULT_COLUMNS, liveResult);
      expect(u.validateResult(u.buildResult({ _id: new Types.ObjectId(), taskId: objectId(goneTaskId), version: 1, status: 'done', ...stamp }), refs())).toMatch(/dangling task_id/);

      const trace = u.buildTrace({ _id: new Types.ObjectId(), streamId: objectId(streamId), taskId: objectId(taskId), kind: 'tool', name: 'search', summary: '', rawPayloadUri: 'https://x/raw', durationMs: 42, ...stamp });
      expect(u.validateTrace(trace, refs())).toBeNull();
      await roundTrip('worky.traces', u.TRACE_COLUMNS, trace);

      const reservation = u.buildReservation({ _id: new Types.ObjectId(), streamId: objectId(streamId), taskId: objectId(taskId), amountUsd: 0.123456789, tokens: 10, status: 'reserved', ...stamp });
      expect(reservation.amount_usd).toBe(0.12345679);
      expect(u.validateReservation(reservation, refs())).toBeNull();
      await roundTrip('worky.budget_reservations', u.RESERVATION_COLUMNS, reservation);

      const cost = u.buildCostEvent({ _id: new Types.ObjectId(), streamId: objectId(streamId), taskId: objectId(goneTaskId), type: 'llm', provider: 'p', modelId: 'm', inputTokens: 100, outputTokens: 20, costUsd: 0.005, createdAt: stamp.createdAt });
      expect(u.validateCostEvent(cost, refs())).toBeNull();
      const liveCost = u.withLiveTask(cost, refs());
      expect(liveCost.task_id).toBeNull();
      await roundTrip('worky.cost_events', u.COST_COLUMNS, liveCost);
    });

    it('maps the mail ledger, the timers and the report', async () => {
      const ledger = u.buildLedger({ _id: new Types.ObjectId(), streamId: objectId(streamId), taskId: null, kind: 'human_task.assigned', dedupKey: oid(), sentAt: at('2026-03-01T09:05:00Z'), createdAt: stamp.createdAt });
      await roundTrip('worky.mail_event_ledger', u.LEDGER_COLUMNS, ledger);
      const timer = u.buildScheduled({ _id: new Types.ObjectId(), streamId: objectId(streamId), taskId: objectId(taskId), eventType: 'human_task.reminder', fireAt: at('2026-04-01T00:00:00Z'), status: 'claimed', claimToken: 'tok', claimedAt: at('2026-04-01T00:00:01Z'), ...stamp });
      expect(u.validateScheduled(timer, refs())).toBeNull();
      await roundTrip('worky.scheduled_events', u.SCHEDULED_COLUMNS, timer);
      const report = u.buildReport({ _id: new Types.ObjectId(), streamId: objectId(streamId), type: 'rich', status: 'ready', summary: 's', markdown: '# r\u0000', metadata: { taskCount: 3 }, generatedAt: stamp.updatedAt, ...stamp });
      expect(report.markdown).toBe('# r');
      expect(u.validateReport(report, refs())).toBeNull();
      await roundTrip('worky.execution_reports', u.REPORT_COLUMNS, report);
    });

    it('migrates an audit row whose scope is not a stream, and a stream-less actor', async () => {
      const row = u.buildAudit({ _id: new Types.ObjectId(), streamId: objectId(goneStreamId), actorUserId: null, action: 'governance.policy.upserted', targetType: 'workspace', targetId: objectId(goneStreamId), details: { a: 1 }, occurredAt: stamp.createdAt });
      await roundTrip('worky.audit_events', u.AUDIT_COLUMNS, row);
    });

    it('maps memory: a source that is gone is dropped, the memory kept', async () => {
      const proposalId = oid();
      const proposal = u.buildProposal({ _id: objectId(proposalId), ownerUserId: objectId(ownerId), sourceStreamId: objectId(goneStreamId), category: 'stream_summary', title: 'T', content: 'C', status: 'confirmed', decidedAt: stamp.updatedAt, ...stamp });
      expect(u.validateProposal(proposal, refs())).toBeNull();
      await roundTrip('worky.memory_proposals', u.PROPOSAL_COLUMNS, u.withLiveMemorySources(proposal, refs()));
      const entry = u.buildEntry({ _id: new Types.ObjectId(), ownerUserId: objectId(ownerId), sourceProposalId: objectId(proposalId), sourceStreamId: objectId(goneStreamId), category: 'preference', title: 'T', content: 'C', ...stamp });
      const fixed = u.withLiveMemorySources(entry, refs({ proposals: [proposalId] }));
      expect(fixed).toMatchObject({ source_stream_id: null, source_proposal_id: proposalId });
      await roundTrip('worky.memory_entries', u.ENTRY_COLUMNS, fixed);
      expect(u.validateProposal(u.buildProposal({ _id: new Types.ObjectId(), ownerUserId: objectId(goneUserId), category: 'stream_summary', title: 't', content: 'c', ...stamp }), refs())).toMatch(/dangling owner_user_id/);
    });

    it('maps a mailbox subscription and an Electric cursor (offset becomes log_offset)', async () => {
      const sub = u.buildSubscription({ _id: new Types.ObjectId(), userId: objectId(ownerId), mailboxAppKey: 'microsoft', subscriptionId: 'sub-1', clientState: 'state', expiresAt: at('2026-04-01T00:00:00Z'), notificationUrl: 'https://x', lastSweptAt: null, ...stamp });
      expect(u.validateSubscription(sub, refs())).toBeNull();
      await roundTrip('worky.mail_subscriptions', u.SUBSCRIPTION_COLUMNS, sub);
      expect(u.validateSubscription(u.buildSubscription({ _id: new Types.ObjectId(), userId: objectId(goneUserId), mailboxAppKey: 'microsoft', ...stamp }), refs())).toMatch(/dangling user_id/);

      const cursor = u.buildCursor({ _id: new Types.ObjectId(), shape: `bf-${ownerId}`, handle: '47951191-1788793491123626', offset: '217352888_0', ...stamp });
      expect(cursor).toMatchObject({ shape: `bf-${ownerId}`, log_offset: '217352888_0' });
      await roundTrip('worky.electric_cursors', u.CURSOR_COLUMNS, cursor, 'shape');
      expect(() => u.buildCursor({ _id: new Types.ObjectId(), shape: '' })).toThrow(BackfillError);
    });

    it('is idempotent: inserting a migrated row again changes nothing', async () => {
      const row = u.buildLedger({ _id: new Types.ObjectId(), streamId: objectId(streamId), kind: 'k', dedupKey: oid(), sentAt: stamp.createdAt, createdAt: stamp.createdAt });
      await u.insertRow(pool, 'worky.mail_event_ledger', u.LEDGER_COLUMNS, row);
      await u.insertRow(pool, 'worky.mail_event_ledger', u.LEDGER_COLUMNS, row);
      const count = await pool.query('SELECT count(*)::int AS n FROM worky.mail_event_ledger WHERE id = $1', [row.id]);
      expect(count.rows[0].n).toBe(1);
    });
  });
});
