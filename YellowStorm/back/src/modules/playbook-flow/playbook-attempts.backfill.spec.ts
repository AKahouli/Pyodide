import { eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { isUniqueViolation, newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import * as u from '../../../scripts/migrate/2026-10-playbook-attempts.units';
import type { Row } from '../../../scripts/migrate/2026-10-playbook-attempts.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import { DynamicReasoningAttemptRepository } from './persistence/dynamic-reasoning-attempt.repository';

/**
 * Drives the attempts backfill mapping, validation and insert with fabricated Mongo-shaped documents
 * (the dev collection holds 28, all of them attempt 0 and none with a policy or planner snapshot) and
 * checks every migrated row reads back identical, then that the repository serves it like an attempt
 * the handler wrote.
 */
describeIntegration('playbook dynamic reasoning attempts backfill mapping (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const oid = (): string => newObjectId();
  const objectId = (hex: string): Types.ObjectId => new Types.ObjectId(hex);
  const repository = new DynamicReasoningAttemptRepository(db as never);

  const ownerId = oid();
  const flowId = oid();
  const executionId = oid();
  const goneExecutionId = oid(); // never inserted
  const goneFlowId = oid(); // never inserted: flow_id is a plain column
  const refs = (): u.AttemptRefs => ({ executions: new Set([executionId]) });

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: ownerId, email: `pbatt-${ownerId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    await db.insert(schema.playbookFlows).values({ id: flowId, ownerId, name: `flow ${flowId}` });
    await db.insert(schema.playbookExecutions).values({ id: executionId, flowId, ownerId });
  });

  afterAll(async () => {
    // The flow cascades to the execution and its attempts.
    await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.id, flowId));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId]));
    await close();
  });

  const doc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: objectId(oid()),
    executionId,
    flowId,
    parentTaskId: `intent-node-${oid()}`,
    parentIteration: 0,
    attempt: 0,
    status: 'direct',
    contextFingerprint: 'sha256:abc',
    inputContextSummary: { sourceCount: 2, ports: [{ portId: 'cv', estimatedTokens: 393, samples: [] }], contextFingerprint: 'sha256:abc' },
    planningStartedAt: new Date('2026-08-27T14:47:55.107Z'),
    revisions: [],
    createdAt: new Date('2026-08-27T14:47:55.108Z'),
    updatedAt: new Date('2026-08-27T14:48:11.580Z'),
    __v: 0,
    ...over,
  });
  const readBack = async (id: unknown): Promise<Row> => {
    const back = await pool.query(`SELECT ${u.ATTEMPT_COLUMNS.join(', ')} FROM ${u.ATTEMPT_TABLE} WHERE id = $1`, [id]);
    expect(back.rows).toHaveLength(1);
    return back.rows[0] as Row;
  };
  const roundTrip = async (row: Row): Promise<Row> => {
    expect(u.validateAttempt(row, refs())).toBeNull();
    await u.insertAttempt(pool, row);
    const back = await readBack(row.id);
    expect(compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), back]]))).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 });
    return back;
  };

  it('migrates a completed attempt with its revisions, accepted plan and decision', async () => {
    const source = doc({
      status: 'completed',
      subgraphId: `sg-${oid()}`,
      decision: { mode: 'plan', confidence: 0.82, consideredFactors: ['a', 'b\u0000'] },
      revisions: [
        { revision: 0, kind: 'proposal', plan: { steps: [{ id: 's1' }] }, validationIssues: [], createdAt: new Date('2026-08-27T14:48:00Z') },
        { revision: 1, kind: 'repair', plan: { steps: [{ id: 's1' }, { id: 's2' }] }, validationIssues: ['cycle'], createdAt: new Date('2026-08-27T14:48:05Z') },
      ],
      acceptedRevision: 1,
      acceptedPlan: { steps: [{ id: 's1' }, { id: 's2' }] },
      acceptedAt: new Date('2026-08-27T14:48:06Z'),
      completedAt: new Date('2026-08-27T14:49:00Z'),
    });
    const row = u.buildAttempt(source);

    expect(row).toMatchObject({
      execution_id: executionId, flow_id: flowId, status: 'completed', accepted_revision: 1, policy_snapshot: null,
      decision: { mode: 'plan', confidence: 0.82, consideredFactors: ['a', 'b'] },
      revisions: [
        { revision: 0, kind: 'proposal', createdAt: '2026-08-27T14:48:00.000Z' },
        { revision: 1, kind: 'repair', validationIssues: ['cycle'], createdAt: '2026-08-27T14:48:05.000Z' },
      ],
    });
    await roundTrip(row);

    const [served] = await repository.listForExecution(executionId).then((all) => all.filter((attempt) => attempt.id === row.id));
    expect(served).toMatchObject({ status: 'completed', subgraphId: source.subgraphId, acceptedRevision: 1, revisions: [{ revision: 0 }, { revision: 1 }] });
    expect(served.revisions[1].createdAt).toEqual(new Date('2026-08-27T14:48:05Z'));
    // A replayed proposal of a migrated attempt is still recognised as a duplicate.
    expect(await repository.pushRevision(
      { executionId, parentTaskId: String(source.parentTaskId), parentIteration: 0, attempt: 0 },
      { revision: 1, kind: 'repair' },
    )).toBe(false);
  });

  it('migrates a direct attempt that never planned, with Mongo-absent fields as NULL', async () => {
    const row = u.buildAttempt(doc({ executionId: executionId.toUpperCase(), flowId: goneFlowId, decision: undefined, revisions: undefined }));

    expect(row).toMatchObject({ execution_id: executionId, flow_id: goneFlowId, decision: null, revisions: [], subgraph_id: null, completed_at: null });
    const back = await roundTrip(row);
    expect(back.revisions).toEqual([]);
  });

  it('reports an attempt whose execution is gone instead of inserting it', () => {
    const row = u.buildAttempt(doc({ executionId: goneExecutionId }));
    expect(u.validateAttempt(row, refs())).toBe(`dangling execution_id ${goneExecutionId} (execution gone from PG; FK would reject)`);
  });

  it('rejects what the table cannot hold', () => {
    expect(u.validateAttempt(u.buildAttempt(doc({ status: 'exploded' })), refs())).toMatch(/status 'exploded'/);
    expect(u.validateAttempt(u.buildAttempt(doc({ parentTaskId: undefined })), refs())).toBe('parentTaskId is empty');
    expect(u.buildAttempt(doc({ status: undefined })).status).toBe('planning');
    expect(() => u.buildAttempt(doc({ executionId: 'nope' }))).toThrow(BackfillError);
    expect(() => u.buildAttempt(doc({ flowId: null }))).toThrow(BackfillError);
  });

  it('is idempotent, and records a clash on the attempt identity as a failure of that row', async () => {
    const source = doc();
    const row = u.buildAttempt(source);
    await roundTrip(row);
    await u.insertAttempt(pool, row);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${u.ATTEMPT_TABLE} WHERE id = $1`, [row.id])).rows[0].n).toBe(1);

    const twin = u.buildAttempt({ ...source, _id: objectId(oid()) });
    const clash = await u.insertAttempt(pool, twin).catch((err: unknown) => err);
    expect(isUniqueViolation(clash, 'uq_playbook_dynamic_reasoning_attempts_attempt')).toBe(true);
  });
});
