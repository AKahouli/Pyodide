import { and, eq, inArray } from 'drizzle-orm';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { ExecutionLeaseRepository, type ExecutionLeaseSlot } from './execution-lease.repository';
import { IdempotencyRepository } from './idempotency.repository';

const leases = schema.playbookExecutionLeases;
const records = schema.playbookIdempotencyRecords;

describeIntegration('playbook lease and idempotency repositories (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const leaseRepo = new ExecutionLeaseRepository(db as never);
  const idempotency = new IdempotencyRepository(db as never);

  // Neither table has a foreign key: executions, owners and flows are plain ids here.
  const executionIds: string[] = [];
  const ownerIds: string[] = [];
  const ownerId = oid();
  const flowId = oid();
  ownerIds.push(ownerId);

  const newExecutionId = (): string => {
    const id = oid();
    executionIds.push(id);
    return id;
  };
  const inFuture = (ms = 60_000): Date => new Date(Date.now() + ms);
  const inPast = (ms = 60_000): Date => new Date(Date.now() - ms);
  const slotOf = (executionId: string, over: Partial<ExecutionLeaseSlot> = {}): ExecutionLeaseSlot => ({
    executionId, ownerId, flowId, scopeType: 'flow', scopeKey: `execution:flow:${flowId}`, slot: 0, expiresAt: inFuture(), ...over,
  });
  const leasesOf = (executionId: string) => db.select().from(leases).where(eq(leases.executionId, executionId));

  afterAll(async () => {
    if (executionIds.length) await db.delete(leases).where(inArray(leases.executionId, executionIds));
    await db.delete(records).where(inArray(records.ownerId, ownerIds));
    await close();
  });

  describe('execution leases', () => {
    it('gives a slot to one execution only, while another slot of the scope stays free', async () => {
      const scopeKey = `execution:owner:${oid()}`;
      const a = newExecutionId();
      const b = newExecutionId();

      expect(await leaseRepo.claimSlot(slotOf(a, { scopeType: 'owner', scopeKey, slot: 0 }))).toBe(true);
      expect(await leaseRepo.claimSlot(slotOf(b, { scopeType: 'owner', scopeKey, slot: 0 }))).toBe(false);
      expect(await leaseRepo.claimSlot(slotOf(b, { scopeType: 'owner', scopeKey, slot: 1 }))).toBe(true);

      expect(await leasesOf(a)).toEqual([expect.objectContaining({ ownerId, flowId, scopeType: 'owner', scopeKey, slot: 0 })]);
      expect(await leaseRepo.hasActive(a)).toBe(true);
      expect(await leaseRepo.hasActive(b)).toBe(true);
    });

    it('refuses a second slot of the same scope type for one execution', async () => {
      const scopeKey = `execution:model:${oid()}`;
      const a = newExecutionId();

      expect(await leaseRepo.claimSlot(slotOf(a, { scopeType: 'model', scopeKey, slot: 0 }))).toBe(true);
      expect(await leaseRepo.claimSlot(slotOf(a, { scopeType: 'model', scopeKey, slot: 1 }))).toBe(false);
      expect(await leasesOf(a)).toHaveLength(1);
    });

    it('treats an expired lease as free before the sweep: its slot is taken over and it no longer counts', async () => {
      const scopeKey = `execution:provider:${oid()}`;
      const stale = newExecutionId();
      const next = newExecutionId();
      expect(await leaseRepo.claimSlot(slotOf(stale, { scopeType: 'provider', scopeKey, expiresAt: inPast() }))).toBe(true);
      expect(await leaseRepo.hasActive(stale)).toBe(false);

      const expiresAt = inFuture(120_000);
      expect(await leaseRepo.claimSlot(slotOf(next, { scopeType: 'provider', scopeKey, expiresAt }))).toBe(true);

      expect(await leasesOf(stale)).toEqual([]);
      const [taken] = await leasesOf(next);
      expect(taken).toMatchObject({ scopeKey, slot: 0, scopeType: 'provider' });
      expect(taken.expiresAt.getTime()).toBe(expiresAt.getTime());
      expect(await leaseRepo.hasActive(next)).toBe(true);
    });

    it('lets exactly one of several concurrent claimers take a slot', async () => {
      const scopeKey = `execution:global:${oid()}`;
      const contenders = Array.from({ length: 6 }, () => newExecutionId());

      const results = await Promise.all(contenders.map((id) => leaseRepo.claimSlot(slotOf(id, { scopeType: 'global', scopeKey }))));

      expect(results.filter(Boolean)).toHaveLength(1);
      const rows = await db.select().from(leases).where(eq(leases.scopeKey, scopeKey));
      expect(rows).toHaveLength(1);
      expect(rows[0].executionId).toBe(contenders[results.indexOf(true)]);
    });

    it('lets exactly one of several concurrent claimers take over an expired slot', async () => {
      const scopeKey = `execution:global:${oid()}`;
      await leaseRepo.claimSlot(slotOf(newExecutionId(), { scopeType: 'global', scopeKey, expiresAt: inPast() }));
      const contenders = Array.from({ length: 6 }, () => newExecutionId());

      const results = await Promise.all(contenders.map((id) => leaseRepo.claimSlot(slotOf(id, { scopeType: 'global', scopeKey }))));

      expect(results.filter(Boolean)).toHaveLength(1);
      const rows = await db.select().from(leases).where(eq(leases.scopeKey, scopeKey));
      expect(rows.map((row) => row.executionId)).toEqual([contenders[results.indexOf(true)]]);
    });

    it('refreshes every lease of the execution, expired ones included, and releases them all', async () => {
      const a = newExecutionId();
      await leaseRepo.claimSlot(slotOf(a, { scopeType: 'owner', scopeKey: `execution:owner:${oid()}`, expiresAt: inPast() }));
      await leaseRepo.claimSlot(slotOf(a, { scopeType: 'flow', scopeKey: `execution:flow:${oid()}` }));
      const expiresAt = inFuture(300_000);

      expect(await leaseRepo.refresh(a.toUpperCase(), expiresAt)).toBe(2);
      expect((await leasesOf(a)).map((row) => row.expiresAt.getTime())).toEqual([expiresAt.getTime(), expiresAt.getTime()]);

      expect(await leaseRepo.releaseExecution(a)).toBe(2);
      expect(await leasesOf(a)).toEqual([]);
      expect(await leaseRepo.hasActive(a)).toBe(false);
      expect(await leaseRepo.releaseExecution(a)).toBe(0);
    });

    it('deletes only the expired leases', async () => {
      const expired = newExecutionId();
      const live = newExecutionId();
      await leaseRepo.claimSlot(slotOf(expired, { scopeType: 'global', scopeKey: `execution:global:${oid()}`, expiresAt: inPast() }));
      await leaseRepo.claimSlot(slotOf(live, { scopeType: 'global', scopeKey: `execution:global:${oid()}` }));

      expect(await leaseRepo.deleteExpired()).toBeGreaterThanOrEqual(1);

      expect(await leasesOf(expired)).toEqual([]);
      expect(await leasesOf(live)).toHaveLength(1);
    });

    it('treats a malformed execution id as holding nothing', async () => {
      expect(await leaseRepo.hasActive('exec-1')).toBe(false);
      expect(await leaseRepo.refresh('exec-1', inFuture())).toBe(0);
      expect(await leaseRepo.releaseExecution('exec-1')).toBe(0);
    });
  });

  describe('idempotency records', () => {
    const reservation = (key: string, over: Partial<Parameters<IdempotencyRepository['reserve']>[0]> = {}) => ({
      ownerId, idempotencyKey: key, payloadHash: 'hash-a', expiresAt: inFuture(), ...over,
    });
    const rowOf = async (owner: string, key: string) =>
      (await db.select().from(records).where(and(eq(records.ownerId, owner), eq(records.idempotencyKey, key))))[0];

    it('reserves a key once and reads the live record back', async () => {
      const key = `key-${oid()}`;

      expect(await idempotency.reserve(reservation(key))).toBe(true);
      expect(await idempotency.reserve(reservation(key, { payloadHash: 'hash-b' }))).toBe(false);

      expect(await idempotency.findLive(ownerId.toUpperCase(), key)).toMatchObject({
        ownerId, idempotencyKey: key, payloadHash: 'hash-a', executionId: null, responseBody: null, expectedStateHash: null, expectedDefinitionRevision: null,
      });
      expect(await idempotency.findLive(ownerId, `other-${key}`)).toBeNull();
    });

    it('scopes a key to its owner', async () => {
      const key = `key-${oid()}`;
      const otherOwner = oid();
      ownerIds.push(otherOwner);

      expect(await idempotency.reserve(reservation(key))).toBe(true);
      expect(await idempotency.reserve(reservation(key, { ownerId: otherOwner }))).toBe(true);
    });

    it('lets exactly one of several concurrent callers reserve a key', async () => {
      const key = `key-${oid()}`;

      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => idempotency.reserve(reservation(key, { payloadHash: `hash-${i}` }))));

      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await idempotency.findLive(ownerId, key))?.payloadHash).toBe(`hash-${results.indexOf(true)}`);
    });

    it('records the execution, the expected save state and the response body on the live record', async () => {
      const key = `key-${oid()}`;
      const executionId = oid();
      await idempotency.reserve(reservation(key));

      expect(await idempotency.update(ownerId, key, { executionId: executionId.toUpperCase() })).toBe(true);
      expect(await idempotency.update(ownerId, key, { expectedStateHash: 'state-1', expectedDefinitionRevision: 4 })).toBe(true);
      expect(await idempotency.update(ownerId, key, { responseBody: { id: 'flow-1', note: 'nul\u0000byte', nested: { revision: 4 } } })).toBe(true);

      expect(await idempotency.findLive(ownerId, key)).toMatchObject({
        executionId, expectedStateHash: 'state-1', expectedDefinitionRevision: 4, responseBody: { id: 'flow-1', note: 'nulbyte', nested: { revision: 4 } }, payloadHash: 'hash-a',
      });
      expect(await idempotency.update(ownerId, `missing-${key}`, { executionId })).toBe(false);
    });

    it('hides an expired record that is not swept yet and lets a new reservation take it over from scratch', async () => {
      const key = `key-${oid()}`;
      await idempotency.reserve(reservation(key, { expiresAt: inPast() }));
      await db.update(records).set({ executionId: oid(), responseBody: { stale: true }, expectedStateHash: 'old', expectedDefinitionRevision: 1 })
        .where(and(eq(records.ownerId, ownerId), eq(records.idempotencyKey, key)));
      const before = await rowOf(ownerId, key);

      expect(await idempotency.findLive(ownerId, key)).toBeNull();
      expect(await idempotency.update(ownerId, key, { executionId: oid() })).toBe(false);

      const expiresAt = inFuture(3_600_000);
      expect(await idempotency.reserve(reservation(key, { payloadHash: 'hash-new', expiresAt }))).toBe(true);
      const after = await idempotency.findLive(ownerId, key);
      expect(after).toMatchObject({ id: before.id, payloadHash: 'hash-new', executionId: null, responseBody: null, expectedStateHash: null, expectedDefinitionRevision: null });
      expect(after?.expiresAt.getTime()).toBe(expiresAt.getTime());
    });

    it('deletes the record whether it is live or expired', async () => {
      const live = `key-${oid()}`;
      const expired = `key-${oid()}`;
      await idempotency.reserve(reservation(live));
      await idempotency.reserve(reservation(expired, { expiresAt: inPast() }));

      expect(await idempotency.delete(ownerId, live)).toBe(true);
      expect(await idempotency.delete(ownerId, expired)).toBe(true);
      expect(await idempotency.delete(ownerId, live)).toBe(false);
      expect(await rowOf(ownerId, expired)).toBeUndefined();
    });

    it('treats a malformed owner id as not found and refuses to reserve under it', async () => {
      expect(await idempotency.findLive('user-1', 'k')).toBeNull();
      expect(await idempotency.update('user-1', 'k', { executionId: oid() })).toBe(false);
      expect(await idempotency.delete('user-1', 'k')).toBe(false);
      await expect(idempotency.reserve(reservation('k', { ownerId: 'user-1' }))).rejects.toThrow('not an ObjectId');
    });
  });
});
