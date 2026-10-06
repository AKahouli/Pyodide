import { inArray } from 'drizzle-orm';
import { isForeignKeyViolation, isUniqueViolation, newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { FlowRepository, castFlowPatch, type NewFlow } from './flow.repository';
import { SharedPlaybookRepository } from './shared-playbook.repository';

describeIntegration('flow and shared-playbook repositories (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const flows = new FlowRepository(db as never);
  const shares = new SharedPlaybookRepository(db as never);

  const ownerId = oid();
  const otherId = oid();
  const recipientId = oid();
  const users = [ownerId, otherId, recipientId];
  const workspaceA = oid();
  const workspaceB = oid();

  const newFlow = (over: Partial<NewFlow> = {}) => flows.create({ ownerId, name: `flow ${oid()}`, ...over });
  const addExecution = async (flowId: string, over: Partial<typeof schema.playbookExecutions.$inferInsert> = {}): Promise<string> => {
    const id = over.id ?? oid();
    await db.insert(schema.playbookExecutions).values({ id, flowId, ownerId, ...over });
    return id;
  };

  beforeAll(async () => {
    for (const id of users) {
      await db.insert(schema.identityUsers).values({ id, email: `pbf-${id.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    }
    for (const id of [workspaceA, workspaceB]) {
      await db.insert(schema.workspaces).values({ id, name: `pbf ${id}`, alias: `pbf-${id}`, storagePrefix: `pbf-${id}`, createdBy: ownerId, allocatedStorage: 1 });
    }
  });

  afterAll(async () => {
    // Flows cascade to their workspace links, shares and executions.
    await db.delete(schema.playbookFlows).where(inArray(schema.playbookFlows.ownerId, users));
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [workspaceA, workspaceB]));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, users));
    await close();
  });

  describe('flows', () => {
    it('creates a flow with the Mongoose defaults and casts the graph like the old schema did', async () => {
      const created = await newFlow({
        description: 'about',
        nodes: [{
          id: 'n1',
          kind: 'step',
          stray: 'dropped',
          input: { ports: [{ id: 'in' }] },
          output: {},
          metadata: {},
          retryPolicy: { maxRetries: 3 },
          hitlPolicy: { mode: 'manual' },
          humanApprovalConfig: {},
        } as never],
        controlEdges: [{ id: 'e1', kind: 'sequential', source: 'n1', target: 'n2' } as never],
        dataBindings: [{ id: 'd1', targetNode: 'n1', targetPort: 'in', sourceKind: 'constant', constantValue: { a: 'x\u0000y' } } as never],
        triggerConfig: { kind: 'manual', params: {} },
      });
      expect(created).toMatchObject({
        ownerId,
        schemaVersion: 1,
        definitionRevision: 0,
        description: 'about',
        settings: { recursionLimit: 25, maxParallelism: 5 },
        hitlPolicy: { mode: 'auto', sensitivity: 'balanced', clarificationEnabled: true, disabledReason: null },
        hitlBlockers: [],
        workspaces: [],
        designSettings: { inferenceModelId: null, nodeSuggestionsMode: 'inherit', approvalSuggestionMode: 'inherit' },
        isFavorite: false,
        reflectionEnabled: false,
        advisorScoringMode: 'llm',
        advisorAutopilotEnabled: false,
        advisorAutopilotTargetScore: null,
        assistantOperationId: null,
        triggerConfig: { kind: 'manual' },
      });
      expect(created.nodes).toEqual([{
        id: 'n1',
        kind: 'step',
        input: { ports: [{ id: 'in', required: false }] },
        output: { ports: [] },
        retryPolicy: { maxRetries: 3, delayMs: 1000 },
        hitlPolicy: {
          mode: 'manual',
          sensitivity: 'balanced',
          clarificationEnabled: true,
          approvalEnabled: true,
          reviewEnabled: false,
          propagateFeedbackDefault: true,
          defaultFeedbackScope: 'downstream_run',
          disabledReason: null,
        },
      }]);
      expect(created.controlEdges).toEqual([{ id: 'e1', kind: 'sequential', source: 'n1', target: 'n2', priority: 0 }]);
      expect(created.dataBindings).toEqual([{ id: 'd1', targetNode: 'n1', targetPort: 'in', sourceKind: 'constant', iteration: 'current', constantValue: { a: 'xy' } }]);
      expect(created.createdAt.getTime()).toBe(created.updatedAt.getTime());
      expect(await flows.findById(created.id)).toEqual(created);
    });

    it('keeps the workspaces in order and drops ids the foreign key cannot hold', async () => {
      const created = await newFlow({ workspaces: [workspaceB.toUpperCase(), 'not-an-id', oid(), workspaceA, workspaceB] });
      expect(created.workspaces).toEqual([workspaceB, workspaceA]);
      const moved = await flows.updateFields(created.id, { workspaces: [workspaceA] });
      expect(moved?.workspaces).toEqual([workspaceA]);
      expect((await flows.findById(created.id))?.workspaces).toEqual([workspaceA]);
    });

    it('surfaces a duplicate name or assistant operation as the named unique violation', async () => {
      const name = `dup ${oid()}`;
      const operation = `op-${oid()}`;
      await newFlow({ name, assistantOperationId: operation });
      const sameName = await newFlow({ name }).catch((e: unknown) => e);
      expect(isUniqueViolation(sameName, 'uq_playbook_flows_owner_name')).toBe(true);
      const sameOperation = await newFlow({ assistantOperationId: operation }).catch((e: unknown) => e);
      expect(isUniqueViolation(sameOperation, 'uq_playbook_flows_assistant_operation')).toBe(true);
      // Another owner may reuse the name.
      await expect(newFlow({ ownerId: otherId, name })).resolves.toMatchObject({ name });
      const found = await flows.findByAssistantOperationId(ownerId, operation);
      expect(found?.name).toBe(name);
      expect(await flows.findByAssistantOperationId(otherId, operation)).toBeNull();
    });

    it('reads by id, owner and id list, treating a malformed id as not found', async () => {
      const a = await newFlow();
      const b = await newFlow({ ownerId: otherId });
      expect(await flows.findById('nope')).toBeNull();
      expect(await flows.findById(oid())).toBeNull();
      expect((await flows.findById(a.id.toUpperCase()))?.id).toBe(a.id);
      expect(await flows.findOwned(a.id, ownerId)).toMatchObject({ id: a.id });
      expect(await flows.findOwned(a.id, otherId)).toBeNull();
      expect((await flows.findByIds([a.id, b.id, 'bad', oid()])).map((flow) => flow.id).sort()).toEqual([a.id, b.id].sort());
      expect(await flows.exists(a.id)).toBe(true);
      expect(await flows.exists('bad')).toBe(false);
      expect(await flows.findOwnerRef(b.id)).toEqual({ id: b.id, ownerId: otherId });
      expect(await flows.listIdsByOwner(otherId)).toContain(b.id);
      expect(await flows.listIdsByOwner(otherId)).not.toContain(a.id);
    });

    it('finds taken names and names sharing a literal prefix', async () => {
      const base = `50%_off ${oid()}`;
      await newFlow({ name: base });
      await newFlow({ name: `${base} (2)` });
      await newFlow({ name: `50%Xoff ${oid()}` });
      expect(await flows.nameTaken(ownerId, base)).toBe(true);
      expect(await flows.nameTaken(ownerId, base.toUpperCase())).toBe(false);
      expect(await flows.nameTaken(otherId, base)).toBe(false);
      expect((await flows.listNamesWithPrefix(ownerId, base)).sort()).toEqual([base, `${base} (2)`]);
    });

    it('updates fields, bumps updatedAt and increments the revision on request', async () => {
      const flow = await newFlow();
      const updated = await flows.updateFields(flow.id, { description: 'new', nodes: [{ id: 'x', kind: 'step' } as never] }, { incrementRevision: true });
      expect(updated).toMatchObject({ description: 'new', definitionRevision: 1, nodes: [{ id: 'x', kind: 'step' }], name: flow.name });
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(flow.updatedAt.getTime());
      const plain = await flows.updateFields(flow.id, { isFavorite: true });
      expect(plain).toMatchObject({ isFavorite: true, definitionRevision: 1 });
      expect(await flows.updateFields('bad', { isFavorite: true })).toBeNull();
      expect(await flows.updateFields(oid(), { isFavorite: true })).toBeNull();
    });

    it('reads back exactly castFlowPatch of what it stored, so a hash of the cast state matches a re-read', async () => {
      const flow = await newFlow();
      class PortDto { id = 'p'; label = 'x\u0000'; }
      const patch = {
        name: 'Round trip',
        description: null,
        triggerConfig: { kind: 'schedule', params: { at: new Date('2026-01-01T00:00:00Z'), empty: {} } },
        hitlBlockers: [{ id: 'b', kind: 'custom', label: 'l', description: 'd', action: 'clarify', matcherType: 'llm_judge' }],
        nodes: [{ id: 'n', kind: 'step', input: { ports: [new PortDto()] }, metadata: { n: 1.5, deep: { list: [{}], none: {} } } }],
        controlEdges: [{ id: 'e', kind: 'sequential', source: 'n', target: 'n' }],
        dataBindings: [{ id: 'd', targetNode: 'n', targetPort: 'p', sourceKind: 'constant', constantValue: { v: [1, 'two'] } }],
        designSettings: { inferenceModelId: null, nodeSuggestionsMode: 'off' },
        advisorAutopilotTargetScore: 0.1 + 0.2,
      } as never;
      const cast = castFlowPatch(patch);
      const saved = await flows.updateFields(flow.id, cast);
      const reread = await flows.findById(flow.id);
      for (const key of Object.keys(cast) as (keyof typeof cast)[]) {
        expect({ key, value: reread?.[key] }).toEqual({ key, value: cast[key] });
        expect({ key, value: saved?.[key] }).toEqual({ key, value: cast[key] });
      }
    });

    it('lets exactly one of two concurrent writers win the expected-revision guard', async () => {
      const flow = await newFlow();
      const outcomes = await Promise.all([
        flows.updateFields(flow.id, { description: 'first' }, { expectedRevision: 0, incrementRevision: true }),
        flows.updateFields(flow.id, { description: 'second' }, { expectedRevision: 0, incrementRevision: true }),
      ]);
      expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1);
      expect((await flows.findById(flow.id))?.definitionRevision).toBe(1);
      expect(await flows.updateFields(flow.id, { description: 'late' }, { expectedRevision: 0, incrementRevision: true })).toBeNull();
    });

    it('guards on the owner and on the updatedAt the caller read', async () => {
      const flow = await newFlow();
      expect(await flows.updateFields(flow.id, { description: 'x' }, { ownerId: otherId })).toBeNull();
      expect(await flows.updateFields(flow.id, { description: 'x' }, { ownerId: 'bad' })).toBeNull();
      const first = await flows.updateFields(flow.id, { description: 'x' }, { ownerId, expectedUpdatedAt: flow.updatedAt });
      expect(first?.description).toBe('x');
      expect(await flows.updateFields(flow.id, { description: 'y' }, { expectedUpdatedAt: flow.updatedAt })).toBeNull();
      expect((await flows.updateFields(flow.id, { description: 'y' }, { expectedUpdatedAt: first!.updatedAt }))?.description).toBe('y');
    });

    it('does not touch the workspaces when a guarded write loses', async () => {
      const flow = await newFlow({ workspaces: [workspaceA] });
      expect(await flows.updateFields(flow.id, { workspaces: [workspaceB] }, { expectedRevision: 5 })).toBeNull();
      expect((await flows.findById(flow.id))?.workspaces).toEqual([workspaceA]);
    });

    it('toggles the favourite flag atomically', async () => {
      const flow = await newFlow();
      const values = await Promise.all([flows.toggleFavorite(flow.id), flows.toggleFavorite(flow.id)]);
      expect(values.sort()).toEqual([false, true]);
      expect((await flows.findById(flow.id))?.isFavorite).toBe(false);
      expect(await flows.toggleFavorite(oid())).toBeNull();
    });

    it('finds flows by trigger kind and params, and writes one trigger param alone', async () => {
      const marker = `sub-${oid()}`;
      const mail = await newFlow({ triggerConfig: { kind: 'mail', params: { enabled: true, subscriptionId: marker, other: 1 } }, workspaces: [workspaceA] });
      await newFlow({ triggerConfig: { kind: 'mail', params: { enabled: false, subscriptionId: marker } } });
      expect(await flows.listByTrigger('mail', { enabled: true, subscriptionId: marker })).toEqual([
        { id: mail.id, ownerId, triggerConfig: { kind: 'mail', params: { enabled: true, subscriptionId: marker, other: 1 } }, workspaces: [workspaceA] },
      ]);
      expect((await flows.listByTrigger('mail', { subscriptionId: marker })).length).toBe(2);

      const at = new Date('2026-09-25T10:00:00.000Z');
      expect(await flows.setTriggerParam(mail.id, 'lastScheduledRunAt', at)).toBe(true);
      expect((await flows.findById(mail.id))?.triggerConfig).toEqual({ kind: 'mail', params: { enabled: true, subscriptionId: marker, other: 1, lastScheduledRunAt: at.toISOString() } });
      const bare = await newFlow();
      await flows.setTriggerParam(bare.id, 'k', 'v');
      expect((await flows.findById(bare.id))?.triggerConfig).toEqual({ params: { k: 'v' } });
    });

    it('writes a node HITL policy in place only while the node is still at its index', async () => {
      const flow = await newFlow({ nodes: [{ id: 'a', kind: 'step' }, { id: 'b', kind: 'step', label: 'B' }] as never });
      expect(await flows.setNodeHitlPolicy(flow.id, ownerId, 1, 'b', { mode: 'off', extra: 1 } as never)).toBe(true);
      const after = await flows.findById(flow.id);
      expect(after?.nodes[1]).toEqual({ id: 'b', kind: 'step', label: 'B', hitlPolicy: expect.objectContaining({ mode: 'off', sensitivity: 'balanced', disabledReason: null }) });
      expect(after?.nodes[1].hitlPolicy).not.toHaveProperty('extra');
      expect(await flows.setNodeHitlPolicy(flow.id, ownerId, 0, 'b', { mode: 'off' } as never)).toBe(false);
      expect(await flows.setNodeHitlPolicy(flow.id, otherId, 1, 'b', { mode: 'off' } as never)).toBe(false);
    });

    it('deletes a flow together with its links, shares and executions', async () => {
      const flow = await newFlow({ workspaces: [workspaceA] });
      await shares.upsert(flow.id, recipientId, ownerId, 'read');
      const executionId = await addExecution(flow.id);
      expect(await flows.deleteOwned(flow.id, otherId)).toBe(false);
      expect(await flows.deleteOwned(flow.id, ownerId)).toBe(true);
      expect(await flows.findById(flow.id)).toBeNull();
      expect(await shares.listForPlaybook(flow.id)).toEqual([]);
      expect(await db.select().from(schema.playbookExecutions).where(inArray(schema.playbookExecutions.id, [executionId]))).toEqual([]);
      expect(await db.select().from(schema.playbookFlowWorkspaces).where(inArray(schema.playbookFlowWorkspaces.flowId, [flow.id]))).toEqual([]);
    });

    it('bulk-deletes only what the owner owns', async () => {
      const mine = await newFlow();
      const theirs = await newFlow({ ownerId: otherId });
      expect(await flows.deleteManyOwned([mine.id, theirs.id, 'bad'], ownerId)).toEqual([mine.id]);
      expect(await flows.exists(theirs.id)).toBe(true);
      expect(await flows.deleteManyOwned([], ownerId)).toEqual([]);
    });

    it('removes an assistant draft only at the expected revision', async () => {
      const operation = `op-${oid()}`;
      const draft = await newFlow({ assistantOperationId: operation });
      expect(await flows.deleteAssistantDraft(ownerId, draft.id, operation, 1)).toBe(false);
      expect(await flows.deleteAssistantDraft(ownerId, draft.id, 'other-op', 0)).toBe(false);
      expect(await flows.deleteAssistantDraft(ownerId, draft.id, operation, 0)).toBe(true);
    });

    it('detaches a workspace from every flow', async () => {
      const a = await newFlow({ workspaces: [workspaceB, workspaceA] });
      const b = await newFlow({ workspaces: [workspaceB] });
      expect(await flows.removeWorkspaceReference(workspaceB)).toBeGreaterThanOrEqual(2);
      expect((await flows.findById(a.id))?.workspaces).toEqual([workspaceA]);
      expect((await flows.findById(b.id))?.workspaces).toEqual([]);
      expect(await flows.removeWorkspaceReference('bad')).toBe(0);
    });
  });

  describe('lists', () => {
    it('lists owned and shared flows with their latest execution, sorted and paginated', async () => {
      const marker = `lst-${oid()}`;
      const at = (iso: string): Date => new Date(iso);
      const old = await newFlow({ ownerId: recipientId, name: `${marker} b-old` });
      const recent = await newFlow({ ownerId: recipientId, name: `${marker} a-recent` });
      const shared = await newFlow({ ownerId: otherId, name: `${marker} c-shared` });
      await newFlow({ ownerId: otherId, name: `${marker} hidden` });
      await db.update(schema.playbookFlows).set({ updatedAt: at('2025-01-01T00:00:00Z') }).where(inArray(schema.playbookFlows.id, [old.id, shared.id]));
      await db.update(schema.playbookFlows).set({ updatedAt: at('2025-06-01T00:00:00Z') }).where(inArray(schema.playbookFlows.id, [recent.id]));
      // The old flow ran last: its latest execution ended after everything else happened.
      await addExecution(old.id, { status: 'completed', createdAt: at('2025-01-02T00:00:00Z'), startedAt: at('2025-01-02T00:00:01Z'), endedAt: at('2025-07-01T00:00:00Z') });
      await addExecution(old.id, { status: 'failed', createdAt: at('2025-03-01T00:00:00Z') });
      // Two executions tie on activity: the lowest id is the latest.
      const lowId = `000000${oid().slice(6)}`;
      await addExecution(shared.id, { id: `ffffff${oid().slice(6)}`, status: 'running', createdAt: at('2025-02-01T00:00:00Z') });
      await addExecution(shared.id, { id: lowId, status: 'queued', createdAt: at('2025-02-01T00:00:00Z') });

      const base = { ownerId: recipientId, sharedFlowIds: [shared.id], search: marker, page: 1, limit: 10 };
      const byActivity = await flows.listAccessible({ ...base, sortBy: 'activityAt', sortOrder: 'desc' });
      expect(byActivity.total).toBe(3);
      expect(byActivity.items.map((item) => item.flow.id)).toEqual([old.id, recent.id, shared.id]);
      expect(byActivity.items[0].latestExecution).toEqual({ status: 'completed', activityAt: at('2025-07-01T00:00:00Z') });
      expect(byActivity.items[1].latestExecution).toBeNull();
      expect(byActivity.items[2].latestExecution).toEqual({ status: 'queued', activityAt: at('2025-02-01T00:00:00Z') });

      const byName = await flows.listAccessible({ ...base, sortBy: 'name', sortOrder: 'asc' });
      expect(byName.items.map((item) => item.flow.name)).toEqual([`${marker} a-recent`, `${marker} b-old`, `${marker} c-shared`]);
      const byUpdate = await flows.listAccessible({ ...base, sortBy: 'updatedAt', sortOrder: 'desc', limit: 1, page: 2 });
      expect(byUpdate.total).toBe(3);
      expect(byUpdate.items.map((item) => item.flow.id)).toHaveLength(1);
      const unknownSort = await flows.listAccessible({ ...base, sortBy: '1; DROP TABLE x', sortOrder: 'sideways' });
      expect(unknownSort.items.map((item) => item.flow.id)).toEqual([recent.id, ...[old.id, shared.id].sort()]);

      const ownOnly = await flows.listAccessible({ ...base, sharedFlowIds: [] });
      expect(ownOnly.items.map((item) => item.flow.id).sort()).toEqual([old.id, recent.id].sort());
    });

    it('treats the search as literal text, case-insensitively', async () => {
      const flow = await newFlow({ ownerId: otherId, name: `100% Done_${oid()}` });
      const found = await flows.listAccessible({ ownerId: otherId, sharedFlowIds: [], search: '100% done_', page: 1, limit: 50 });
      expect(found.items.map((item) => item.flow.id)).toContain(flow.id);
      const percent = await flows.listAccessible({ ownerId: otherId, sharedFlowIds: [], search: '%', page: 1, limit: 100 });
      expect(percent.items.every((item) => item.flow.name.includes('%'))).toBe(true);
      expect(await flows.listAccessible({ ownerId: 'bad', sharedFlowIds: [], page: 1, limit: 5 })).toEqual({ items: [], total: 0 });
    });

    it('searches names exactly, by prefix or anywhere, within a workspace when asked', async () => {
      const marker = `srch${oid()}`;
      const exact = await newFlow({ name: marker, workspaces: [workspaceA] });
      const prefixed = await newFlow({ name: `${marker} report` });
      const partial = await newFlow({ name: `weekly ${marker}` });
      const scope = { ownerId, sharedFlowIds: [], limit: 10 };
      expect((await flows.search({ ...scope, name: { text: marker.toUpperCase(), match: 'exact' } })).map((row) => row.id)).toEqual([exact.id]);
      expect((await flows.search({ ...scope, name: { text: marker, match: 'prefix' } })).map((row) => row.id).sort()).toEqual([exact.id, prefixed.id].sort());
      expect((await flows.search({ ...scope, name: { text: marker, match: 'partial' } })).map((row) => row.id).sort()).toEqual([exact.id, prefixed.id, partial.id].sort());
      expect((await flows.search({ ...scope, workspaceId: workspaceA, name: { text: marker, match: 'partial' } })).map((row) => row.id)).toEqual([exact.id]);
      const recent = await flows.search({ ...scope, limit: 1 });
      expect(recent).toHaveLength(1);
      expect(recent[0]).toEqual({ id: expect.any(String), name: expect.any(String), description: null, definitionRevision: 0, updatedAt: expect.any(Date) });
    });

    it('indexes the nodes of every accessible flow', async () => {
      const flow = await newFlow({ ownerId: recipientId, nodes: [{ id: 'n1', kind: 'step', label: 'First' }, { id: 'n2', kind: 'step' }] as never });
      const index = await flows.listNodeIndex(recipientId, []);
      expect(index.find((row) => row.id === flow.id)).toEqual({ id: flow.id, name: flow.name, nodes: [{ id: 'n1', label: 'First' }, { id: 'n2', label: null }] });
    });
  });

  describe('shared playbooks', () => {
    it('upserts one grant per recipient and reads it back every way the service needs', async () => {
      const flow = await newFlow();
      const first = await shares.upsert(flow.id, recipientId, ownerId, 'read');
      const again = await shares.upsert(flow.id, recipientId, otherId, 'write');
      expect(again).toMatchObject({ id: first.id, permission: 'write', sharedBy: otherId, sharedWith: recipientId, playbookId: flow.id });
      await shares.upsert(flow.id, otherId, ownerId, 'read');

      expect((await shares.listForPlaybook(flow.id)).map((share) => share.sharedWith)).toHaveLength(2);
      expect(await shares.findPermission(recipientId, flow.id)).toBe('write');
      expect(await shares.findPermission(ownerId, flow.id)).toBeNull();
      expect(await shares.findPermission('bad', flow.id)).toBeNull();
      expect(await shares.listPlaybookIdsSharedWith(recipientId)).toContain(flow.id);
      expect((await shares.listSharedWith(recipientId)).find((share) => share.playbookId === flow.id)).toMatchObject({ id: first.id, sharedBy: otherId });

      expect((await shares.updatePermission(flow.id, first.id, 'read'))?.permission).toBe('read');
      expect(await shares.updatePermission(oid(), first.id, 'read')).toBeNull();
      expect((await shares.delete(flow.id, first.id))?.sharedWith).toBe(recipientId);
      expect(await shares.delete(flow.id, first.id)).toBeNull();
      expect(await shares.deleteAllForPlaybook(flow.id)).toBe(1);
      expect(await shares.listForPlaybook(flow.id)).toEqual([]);
    });

    it('rejects a grant on a flow that does not exist', async () => {
      const error = await shares.upsert(oid(), recipientId, ownerId, 'read').catch((e: unknown) => e);
      expect(isForeignKeyViolation(error)).toBe(true);
    });
  });
});
