import { eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import * as u from '../../../scripts/migrate/2026-10-playbook-flows.units';
import type { PlaybookFlowRefs, Row } from '../../../scripts/migrate/2026-10-playbook-flows.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import { FlowRepository } from './persistence/flow.repository';

/**
 * Drives the flows / shares backfill mapping with fabricated Mongo-shaped documents (dangling
 * workspaces, missing defaults, BSON values inside the graph) and checks every migrated row reads
 * back identical, exactly as the runner's checksum does.
 */
describeIntegration('playbook flows backfill mapping (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const flows = new FlowRepository(db as never);
  const oid = (): string => newObjectId();
  const objectId = (hex: string): Types.ObjectId => new Types.ObjectId(hex);
  const at = (iso: string): Date => new Date(iso);

  const ownerId = oid();
  const recipientId = oid();
  const goneUserId = oid(); // never inserted
  const workspaceA = oid();
  const workspaceB = oid();
  const goneWorkspace = oid(); // never inserted

  const refs = (over: Partial<Record<keyof PlaybookFlowRefs, string[]>> = {}): PlaybookFlowRefs => ({
    users: new Set(over.users ?? [ownerId, recipientId]),
    workspaces: new Set(over.workspaces ?? [workspaceA, workspaceB]),
    flows: new Set(over.flows ?? []),
  });
  const stamp = { createdAt: at('2026-03-01T09:00:00Z'), updatedAt: at('2026-03-01T09:30:00Z') };

  beforeAll(async () => {
    for (const id of [ownerId, recipientId]) {
      await db.insert(schema.identityUsers).values({ id, email: `pbf-bf-${id.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    }
    for (const id of [workspaceA, workspaceB]) {
      await db.insert(schema.workspaces).values({ id, name: `pbf bf ${id}`, alias: `pbf-bf-${id}`, storagePrefix: `pbf-bf-${id}`, createdBy: ownerId, allocatedStorage: 1 });
    }
  });

  afterAll(async () => {
    await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.ownerId, ownerId));
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [workspaceA, workspaceB]));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId, recipientId]));
    await close();
  });

  const readBack = async (table: string, columns: string[], id: unknown): Promise<Row> => {
    const back = await pool.query(`SELECT ${u.checksumSelect(columns)} FROM ${table} WHERE id = $1`, [id]);
    expect(back.rows).toHaveLength(1);
    return back.rows[0] as Row;
  };
  const sameContent = (row: Row, back: Row) =>
    expect(compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), back]]))).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 });

  const flowDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: objectId(oid()),
    ownerId: ownerId.toUpperCase(),
    assistantOperationId: `op-${oid()}`,
    generationProvenance: { source: 'conversation_handoff', handoffVersion: 1, acceptedAt: at('2026-02-01T00:00:00Z'), confirmedWorkspaceIds: [workspaceA] },
    schemaVersion: 1,
    definitionRevision: 7,
    name: `Backfilled ${oid()}`,
    description: 'Imported \u0000flow',
    triggerConfig: { kind: 'schedule', params: { enabled: true, lastScheduledRunAt: at('2026-02-02T08:00:00Z') } },
    settings: { recursionLimit: 30, maxParallelism: 2 },
    hitlPolicy: { mode: 'manual', sensitivity: 'strict', disabledReason: null },
    hitlBlockers: [{ id: 'b1', kind: 'custom', createdAt: at('2026-01-01T00:00:00Z'), matcherConfig: { rule: 'x' } }],
    nodes: [
      { id: 'n1', kind: 'step', label: 'Draft', metadata: { toolBindings: [{ connectorId: 'c1', fixedParams: { a: 1 } }], sourceId: objectId(oid()) } },
      { id: 'n2', kind: 'router', routerConfig: { outputLabels: ['a'], maxIterations: 2, conditions: [] } },
    ],
    controlEdges: [{ id: 'e1', kind: 'sequential', source: 'n1', target: 'n2', priority: 0 }],
    dataBindings: [{ id: 'd1', targetNode: 'n2', targetPort: 'in', sourceKind: 'constant', constantValue: { text: 'x' }, iteration: 'current' }],
    workspaces: [workspaceB, goneWorkspace, 'not-an-id', workspaceA, workspaceB.toUpperCase()],
    designSettings: { inferenceModelId: 'm1', nodeSuggestionsMode: 'inherit' },
    isFavorite: true,
    reflectionEnabled: true,
    advisorScoringMode: 'heuristic',
    advisorAutopilotEnabled: true,
    advisorAutopilotTargetScore: 0.85,
    advisorAutopilotMaxTurns: 4,
    __v: 3,
    ...stamp,
    ...over,
  });

  describe('flows', () => {
    it('maps every field, inserts the flow with its live workspaces in order and reads back identical', async () => {
      const row = u.buildFlow(flowDoc());
      expect(Object.keys(row)).not.toContain('workspaces');
      expect(row).toMatchObject({ owner_id: ownerId, description: 'Imported flow', definition_revision: 7, advisor_scoring_mode: 'heuristic' });
      expect(u.flowWorkspaces(row)).toEqual([workspaceB, goneWorkspace, 'not-an-id', workspaceA]);
      expect(u.liveWorkspaces(row, refs())).toEqual([workspaceB, workspaceA]);
      expect(u.validateFlow(row, refs())).toBeNull();

      await u.insertFlow(pool, row, refs());
      sameContent(row, await readBack('playbook.flows', u.FLOW_COLUMNS, row.id));

      // The repository reads it as the service will: workspaces in order, BSON values as JSON.
      const record = await flows.findById(String(row.id));
      expect(record?.workspaces).toEqual([workspaceB, workspaceA]);
      expect(record?.triggerConfig).toEqual({ kind: 'schedule', params: { enabled: true, lastScheduledRunAt: '2026-02-02T08:00:00.000Z' } });
      expect(typeof (record?.nodes[0].metadata as { sourceId?: unknown }).sourceId).toBe('string');
      expect(record?.createdAt).toEqual(stamp.createdAt);
    });

    it('is idempotent: a second run leaves the flow and its workspaces as they are', async () => {
      const row = u.buildFlow(flowDoc());
      await u.insertFlow(pool, row, refs());
      await u.insertFlow(pool, row, refs());
      const links = await pool.query('SELECT workspace_id, position FROM playbook.flow_workspaces WHERE flow_id = $1 ORDER BY position', [row.id]);
      expect(links.rows).toEqual([{ workspace_id: workspaceB, position: 0 }, { workspace_id: workspaceA, position: 1 }]);
    });

    it('fills the defaults Mongoose applied on read and normalises what the schema now rejects', async () => {
      const row = u.buildFlow(flowDoc({
        assistantOperationId: objectId(oid()),
        generationProvenance: 'not an object',
        schemaVersion: undefined,
        definitionRevision: undefined,
        description: undefined,
        triggerConfig: undefined,
        settings: undefined,
        hitlPolicy: undefined,
        hitlBlockers: undefined,
        nodes: undefined,
        controlEdges: 'bad',
        dataBindings: undefined,
        workspaces: undefined,
        designSettings: undefined,
        isFavorite: undefined,
        reflectionEnabled: undefined,
        advisorScoringMode: null,
        advisorAutopilotEnabled: undefined,
        advisorAutopilotTargetScore: undefined,
        advisorAutopilotMaxTurns: undefined,
      }));
      expect(row).toMatchObject({
        assistant_operation_id: null,
        generation_provenance: null,
        schema_version: 1,
        definition_revision: 0,
        description: null,
        trigger_config: null,
        settings: { recursionLimit: 25, maxParallelism: 5 },
        hitl_policy: {
          mode: 'auto',
          sensitivity: 'balanced',
          clarificationEnabled: true,
          approvalEnabled: true,
          reviewEnabled: false,
          propagateFeedbackDefault: true,
          defaultFeedbackScope: 'downstream_run',
          disabledReason: null,
        },
        hitl_blockers: [],
        nodes: [],
        control_edges: [],
        data_bindings: [],
        design_settings: { inferenceModelId: null, nodeSuggestionsMode: 'inherit', approvalSuggestionMode: 'inherit' },
        is_favorite: false,
        reflection_enabled: false,
        advisor_scoring_mode: 'llm',
        advisor_autopilot_enabled: false,
        advisor_autopilot_target_score: null,
        advisor_autopilot_max_turns: null,
      });
      expect(u.validateFlow(row, refs())).toBeNull();
      await u.insertFlow(pool, row, refs());
      sameContent(row, await readBack('playbook.flows', u.FLOW_COLUMNS, row.id));
      expect((await flows.findById(String(row.id)))?.workspaces).toEqual([]);
    });

    it('reports what the model cannot hold', () => {
      const verdict = (over: Record<string, unknown>) => u.validateFlow(u.buildFlow(flowDoc(over)), refs());
      expect(verdict({ ownerId: objectId(goneUserId) })).toMatch(/dangling owner_id/);
      expect(verdict({ name: 'x' })).toMatch(/name length 1 is outside 2\.\.100/);
      expect(verdict({ name: 'x'.repeat(101) })).toMatch(/name length 101/);
      expect(verdict({ name: undefined })).toMatch(/name length 0/);
      expect(verdict({ description: 'd'.repeat(80001) })).toMatch(/description length 80001 exceeds 80000/);
      expect(verdict({ advisorScoringMode: 'magic' })).toMatch(/advisor_scoring_mode 'magic'/);
      expect(() => u.buildFlow(flowDoc({ _id: 'legacy-id' }))).toThrow(BackfillError);
      expect(() => u.buildFlow(flowDoc({ ownerId: 'someone' }))).toThrow(/ownerId is not a 24-char hex id/);
    });
  });

  describe('shared playbooks', () => {
    it('maps a share, defaults its permission and reads back identical', async () => {
      const flow = u.buildFlow(flowDoc());
      await u.insertFlow(pool, flow, refs());
      const row = u.buildShare({ _id: objectId(oid()), playbookId: objectId(String(flow.id)), sharedBy: objectId(ownerId), sharedWith: objectId(recipientId), __v: 0, ...stamp });
      expect(row.permission).toBe('read');
      expect(u.validateShare(row, refs({ flows: [String(flow.id)] }))).toBeNull();
      await u.insertRow(pool, 'playbook.shared_playbooks', u.SHARE_COLUMNS, row);
      sameContent(row, await readBack('playbook.shared_playbooks', u.SHARE_COLUMNS, row.id));
      // Re-running is a no-op.
      await u.insertRow(pool, 'playbook.shared_playbooks', u.SHARE_COLUMNS, row);
      expect((await pool.query('SELECT count(*)::int AS n FROM playbook.shared_playbooks WHERE playbook_id = $1', [flow.id])).rows[0].n).toBe(1);
    });

    it('reads the legacy flowId field and reports shares whose flow or users are gone', () => {
      const flowId = oid();
      const legacy = u.buildShare({ _id: objectId(oid()), flowId: objectId(flowId), sharedBy: objectId(ownerId), sharedWith: objectId(recipientId), permission: 'write', ...stamp });
      expect(legacy.playbook_id).toBe(flowId);
      expect(u.validateShare(legacy, refs({ flows: [flowId] }))).toBeNull();
      expect(u.validateShare(legacy, refs())).toMatch(/dangling playbook_id .* \(flow gone; FK would reject\)/);
      expect(u.validateShare({ ...legacy, shared_with: goneUserId }, refs({ flows: [flowId] }))).toMatch(/dangling shared_with/);
      expect(u.validateShare({ ...legacy, permission: 'owner' }, refs({ flows: [flowId] }))).toMatch(/permission 'owner'/);
      expect(() => u.buildShare({ _id: objectId(oid()), sharedBy: objectId(ownerId), sharedWith: objectId(recipientId) })).toThrow(/playbookId is not a 24-char hex id/);
    });
  });
});
