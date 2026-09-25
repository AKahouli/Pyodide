import { asc, eq, sql } from 'drizzle-orm';
import { Types } from 'mongoose';
import { newObjectId, withTransaction } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import {
  buildEvent,
  DELIVERY_COLUMNS,
  EVENT_COLUMNS,
  insertEvent,
  validateEvent,
  type Row,
} from '../../../scripts/migrate/2026-10-integration-events.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import type { IntegrationEventEnvelope, IntegrationEventHandler } from './interfaces/integration-event.interface';
import { IntegrationEventDispatcherService } from './services/integration-event-dispatcher.service';
import { IntegrationEventHandlerRegistryService } from './services/integration-event-handler-registry.service';
import { IntegrationEventOutboxService } from './services/integration-event-outbox.service';

const events = schema.opsIntegrationEvents;
const deliveries = schema.opsIntegrationEventDeliveries;

describeIntegration('integration-events outbox and dispatcher (integration)', () => {
  const { db, close } = makeTestDb();
  const logger = { setContext: jest.fn(), debug: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const outbox = new IntegrationEventOutboxService(db as never, logger as never);
  let enabled = true;
  const features = { isEnabled: () => enabled };

  const TYPE = 'it.spec.event.v1';
  const oid = (): string => newObjectId();

  const newDispatcher = (handlers: IntegrationEventHandler[]) => {
    const registry = new IntegrationEventHandlerRegistryService();
    handlers.forEach((handler) => registry.register(handler));
    return new IntegrationEventDispatcherService(db as never, registry, features as never);
  };
  const handler = (handlerKey: string, handle: (event: IntegrationEventEnvelope) => Promise<void> = () => Promise.resolve()): IntegrationEventHandler & { calls: IntegrationEventEnvelope[] } => {
    const calls: IntegrationEventEnvelope[] = [];
    return { handlerKey, eventTypes: [TYPE], calls, handle: async (event) => { calls.push(event); await handle(event); } };
  };
  const record = async (over: Partial<Parameters<typeof outbox.record>[0]> = {}) => {
    const eventId = over.eventId ?? `it-${oid()}`;
    await outbox.record({ eventId, eventType: TYPE, aggregateType: 'it-spec', aggregateId: oid(), payload: { hello: 'world' }, ...over });
    return eventId;
  };
  const rowOf = async (eventId: string) => (await db.select().from(events).where(eq(events.eventId, eventId)))[0];
  const deliveriesOf = async (eventId: string) => {
    const row = await rowOf(eventId);
    return db.select().from(deliveries).where(eq(deliveries.integrationEventId, row.id)).orderBy(asc(deliveries.handlerKey));
  };
  const makeDue = (eventId: string) => db.update(events).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(events.eventId, eventId));

  beforeEach(async () => {
    enabled = true;
    // The test database is ours: nothing else may be claimed by a dispatcher under test.
    await db.execute(sql`DELETE FROM ops.integration_events`);
  });
  afterAll(async () => {
    await db.execute(sql`DELETE FROM ops.integration_events`);
    await close();
  });

  describe('outbox', () => {
    it('records an event as pending and due, and ignores a second record of the same event id', async () => {
      const occurredAt = new Date('2026-09-01T10:00:00Z');
      const eventId = await record({ payload: { nested: { list: [1, 2] }, when: occurredAt, gone: undefined }, occurredAt, correlationId: 'corr-1', causationId: 'cause-1' });
      const again = await record({ eventId, payload: { changed: true } });

      expect(again).toBe(eventId);
      const rows = await db.select().from(events).where(eq(events.eventId, eventId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        eventType: TYPE, aggregateType: 'it-spec', status: 'pending', attempts: 0, lockOwner: null, correlationId: 'corr-1', causationId: 'cause-1',
        payload: { nested: { list: [1, 2] }, when: '2026-09-01T10:00:00.000Z' },
      });
      expect(rows[0].occurredAt.toISOString()).toBe('2026-09-01T10:00:00.000Z');
      expect(rows[0].nextAttemptAt!.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('strips U+0000 from the payload and refuses one over 64 KiB', async () => {
      const eventId = await record({ payload: { text: 'bad\u0000text', ['k\u0000ey']: 1 } });
      expect((await rowOf(eventId)).payload).toEqual({ text: 'badtext', key: 1 });
      await expect(record({ payload: { big: 'x'.repeat(64 * 1024 + 1) } })).rejects.toThrow('too large');
    });

    it('joins the caller\'s transaction: it commits with it and disappears when it rolls back', async () => {
      const kept = `it-${oid()}`;
      const lost = `it-${oid()}`;
      await withTransaction(db, async () => { await record({ eventId: kept }); });
      await expect(withTransaction(db, async () => {
        await record({ eventId: lost });
        throw new Error('the change this event announces failed');
      })).rejects.toThrow('announces failed');

      expect(await rowOf(kept)).toBeDefined();
      expect(await rowOf(lost)).toBeUndefined();
    });

    it('records several events in order', async () => {
      const ids = [`it-${oid()}`, `it-${oid()}`];
      await outbox.recordMany(ids.map((eventId) => ({ eventId, eventType: TYPE, aggregateType: 'it-spec', aggregateId: oid(), payload: {} })));
      expect(await Promise.all(ids.map(async (id) => (await rowOf(id)) !== undefined))).toEqual([true, true]);
    });
  });

  describe('dispatch', () => {
    it('delivers to the handlers of the type with the envelope, then completes the event', async () => {
      const a = handler('it.a');
      const other = { ...handler('it.other'), eventTypes: ['something.else.v1'] };
      const occurredAt = new Date('2026-09-02T08:00:00Z');
      const eventId = await record({ occurredAt, correlationId: 'corr-9', payload: { documentId: 'd1' } });

      await newDispatcher([a, other]).dispatch();

      expect(a.calls).toHaveLength(1);
      expect(a.calls[0]).toMatchObject({ eventId, eventType: TYPE, aggregateType: 'it-spec', payload: { documentId: 'd1' }, correlationId: 'corr-9' });
      expect(a.calls[0].occurredAt).toEqual(occurredAt);
      expect(a.calls[0]).not.toHaveProperty('causationId');
      expect(other.calls).toHaveLength(0);

      expect(await rowOf(eventId)).toMatchObject({ status: 'completed', attempts: 1, lockOwner: null, lockedAt: null, lastError: null });
      expect((await rowOf(eventId)).processedAt).toBeInstanceOf(Date);
      expect(await deliveriesOf(eventId)).toMatchObject([{ handlerKey: 'it.a', status: 'completed', attempts: 1, lastError: null }]);
    });

    it('completes an event nobody listens to, and does nothing while dispatch is switched off', async () => {
      const eventId = await record();
      enabled = false;
      await newDispatcher([handler('it.a')]).dispatch();
      expect((await rowOf(eventId)).status).toBe('pending');

      enabled = true;
      await newDispatcher([]).dispatch();
      expect((await rowOf(eventId)).status).toBe('completed');
    });

    it('retries a failed delivery with a backoff, without running the handler that already succeeded', async () => {
      const good = handler('it.good');
      let failures = 1;
      const flaky = handler('it.flaky', () => (failures-- > 0 ? Promise.reject(new Error('downstream is down')) : Promise.resolve()));
      const eventId = await record();

      await newDispatcher([good, flaky]).dispatch();
      const failed = await rowOf(eventId);
      expect(failed).toMatchObject({ status: 'failed', attempts: 1, lockOwner: null, lastError: 'One or more integration-event handlers failed' });
      expect(failed.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await deliveriesOf(eventId)).toMatchObject([
        { handlerKey: 'it.flaky', status: 'failed', attempts: 1, lastError: 'downstream is down' },
        { handlerKey: 'it.good', status: 'completed', attempts: 1 },
      ]);

      // Not due yet: a dispatch leaves it alone. Once due, only the failed handler runs again.
      await newDispatcher([good, flaky]).dispatch();
      expect(flaky.calls).toHaveLength(1);
      await makeDue(eventId);
      await newDispatcher([good, flaky]).dispatch();

      expect(good.calls).toHaveLength(1);
      expect(flaky.calls).toHaveLength(2);
      expect(await rowOf(eventId)).toMatchObject({ status: 'completed', attempts: 2, lastError: null });
      expect(await deliveriesOf(eventId)).toMatchObject([
        { handlerKey: 'it.flaky', status: 'completed', attempts: 2 },
        { handlerKey: 'it.good', status: 'completed', attempts: 1 },
      ]);
    });

    it('dead-letters an event on its tenth failed attempt', async () => {
      const eventId = await record();
      await db.update(events).set({ attempts: 9 }).where(eq(events.eventId, eventId));

      await newDispatcher([handler('it.broken', () => Promise.reject(new Error('still broken')))]).dispatch();

      expect(await rowOf(eventId)).toMatchObject({ status: 'dead_letter', attempts: 10 });
      await makeDue(eventId);
      await newDispatcher([handler('it.broken')]).dispatch();
      expect((await rowOf(eventId)).status).toBe('dead_letter');
    });

    it('fails an event whose earlier failing handler is no longer registered', async () => {
      const eventId = await record();
      const row = await rowOf(eventId);
      await db.insert(deliveries).values({ integrationEventId: row.id, handlerKey: 'it.removed', status: 'failed', attempts: 1, lastError: 'old failure' });

      await newDispatcher([handler('it.a')]).dispatch();

      expect(await rowOf(eventId)).toMatchObject({ status: 'failed', lastError: 'A previously failing integration-event handler is unavailable' });
    });

    it('hands each event to exactly one of two dispatchers claiming at the same time', async () => {
      const seenA = handler('it.count');
      const seenB = handler('it.count');
      const ids: string[] = [];
      for (let i = 0; i < 8; i += 1) ids.push(await record());

      await Promise.all([newDispatcher([seenA]).dispatch(), newDispatcher([seenB]).dispatch()]);

      const delivered = [...seenA.calls, ...seenB.calls].map((call) => call.eventId).sort();
      expect(delivered).toEqual([...ids].sort());
      expect(await Promise.all(ids.map(async (id) => (await rowOf(id)).status))).toEqual(ids.map(() => 'completed'));
    });

    it('delivers in the order events became due', async () => {
      const seen = handler('it.order');
      const ids = [`it-${oid()}`, `it-${oid()}`, `it-${oid()}`];
      const base = Date.now() - 60_000;
      // Recorded out of order on purpose: the due time decides.
      for (const [index, position] of [2, 0, 1].entries()) {
        await record({ eventId: ids[position] });
        await db.update(events).set({ nextAttemptAt: new Date(base + index * 1000 * -1) }).where(eq(events.eventId, ids[position]));
      }
      // due times: ids[2] = base, ids[0] = base - 1s, ids[1] = base - 2s
      await newDispatcher([seen]).dispatch();
      expect(seen.calls.map((call) => call.eventId)).toEqual([ids[1], ids[0], ids[2]]);
    });

    it('takes over a claim whose dispatcher died, and leaves a fresh claim alone', async () => {
      const stale = await record();
      const fresh = await record();
      const longAgo = new Date(Date.now() - 5 * 60_000);
      await db.update(events).set({ status: 'processing', lockOwner: 'dead-dispatcher', lockedAt: longAgo, attempts: 1 }).where(eq(events.eventId, stale));
      await db.update(events).set({ status: 'processing', lockOwner: 'busy-dispatcher', lockedAt: new Date(Date.now() - 10_000), attempts: 1 }).where(eq(events.eventId, fresh));

      const seen = handler('it.a');
      await newDispatcher([seen]).dispatch();

      expect(seen.calls.map((call) => call.eventId)).toEqual([stale]);
      expect(await rowOf(stale)).toMatchObject({ status: 'completed', attempts: 2 });
      expect(await rowOf(fresh)).toMatchObject({ status: 'processing', lockOwner: 'busy-dispatcher' });
    });

    it('does not record an outcome once its claim was taken over', async () => {
      const eventId = await record();
      const slow = handler('it.slow', async () => {
        // Another dispatcher takes the claim while this handler is still running.
        await db.update(events).set({ lockOwner: 'thief' }).where(eq(events.eventId, eventId));
      });

      await newDispatcher([slow]).dispatch();

      expect(await rowOf(eventId)).toMatchObject({ status: 'processing', lockOwner: 'thief' });
      expect(await deliveriesOf(eventId)).toMatchObject([{ handlerKey: 'it.slow', status: 'pending', attempts: 0 }]);
    });

    it('is removed with its deliveries when the event row is deleted', async () => {
      const eventId = await record();
      await newDispatcher([handler('it.a')]).dispatch();
      const row = await rowOf(eventId);
      await db.delete(events).where(eq(events.eventId, eventId));
      expect(await db.select().from(deliveries).where(eq(deliveries.integrationEventId, row.id))).toEqual([]);
    });
  });
});

/**
 * The outbox is small and clean in dev, so the backfill would never meet a dead letter with a failed
 * delivery, a claim left by a dead dispatcher or a payload holding BSON dates. This drives the same
 * mapping and insert with fabricated Mongo-shaped documents. It shares this file with the dispatcher
 * suite because both need the outbox table to themselves: spec files run in parallel workers.
 */
describeIntegration('integration-events backfill mapping (integration)', () => {
  const { pool, close } = makeTestDb();
  const at = (iso: string): Date => new Date(iso);
  const rows = (): Promise<void> => pool.query("DELETE FROM ops.integration_events WHERE aggregate_type = 'bf-spec'").then(() => undefined);

  const eventDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: new Types.ObjectId(), eventId: `bf-${new Types.ObjectId().toHexString()}`, eventType: 'workspace.document.registered.v1', aggregateType: 'bf-spec',
    aggregateId: new Types.ObjectId().toHexString(), payload: { documentId: 'd1', uploadedAt: at('2026-08-13T12:00:00Z'), nested: { list: [1, 2] } },
    occurredAt: at('2026-08-13T12:00:00Z'), status: 'completed', attempts: 2, nextAttemptAt: at('2026-08-13T12:00:00Z'), processedAt: at('2026-08-13T12:00:05Z'),
    correlationId: 'corr-1', createdAt: at('2026-08-13T12:00:00Z'), updatedAt: at('2026-08-13T12:00:05Z'),
    deliveries: [
      { handlerKey: 'governance.workspace-events.v1', status: 'completed', attempts: 1, completedAt: at('2026-08-13T12:00:04Z') },
      { handlerKey: 'semantic-model.source-events.v1', status: 'failed', attempts: 2, lastError: 'connect ECONNREFUSED 127.0.0.1:8010' },
    ],
    ...over,
  });
  const readBack = async (id: unknown) => {
    const back = await pool.query(`SELECT ${EVENT_COLUMNS.join(', ')} FROM ops.integration_events WHERE id = $1`, [id]);
    expect(back.rows).toHaveLength(1);
    return back.rows[0] as Row;
  };

  beforeEach(rows);
  afterAll(async () => {
    await rows();
    await close();
  });

  it('maps every column and both deliveries, inserts, and reads back identical', async () => {
    const row = buildEvent(eventDoc());
    expect(validateEvent(row)).toBeNull();
    await insertEvent(pool, row);

    expect(compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), await readBack(row.id)]]))).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 });
    // BSON dates inside the payload become ISO strings, as the live outbox writes them.
    expect((await readBack(row.id)).payload).toEqual({ documentId: 'd1', uploadedAt: '2026-08-13T12:00:00.000Z', nested: { list: [1, 2] } });
    const stored = await pool.query(`SELECT ${DELIVERY_COLUMNS.join(', ')} FROM ops.integration_event_deliveries WHERE integration_event_id = $1 ORDER BY handler_key`, [row.id]);
    expect(stored.rows).toMatchObject([
      { handler_key: 'governance.workspace-events.v1', status: 'completed', attempts: 1, last_error: null, completed_at: at('2026-08-13T12:00:04Z') },
      { handler_key: 'semantic-model.source-events.v1', status: 'failed', attempts: 2, last_error: 'connect ECONNREFUSED 127.0.0.1:8010', completed_at: null },
    ]);
  });

  it('keeps a dead letter and a claim as they are, and strips U+0000', async () => {
    const dead = buildEvent(eventDoc({ status: 'dead_letter', attempts: 10, lastError: 'One or more integration-event handlers failed', payload: { text: 'bad text' }, processedAt: undefined }));
    const claimed = buildEvent(eventDoc({ status: 'processing', lockOwner: 'old-dispatcher', lockedAt: at('2026-09-24T10:00:00Z'), attempts: 1, processedAt: undefined, deliveries: [] }));
    await insertEvent(pool, dead);
    await insertEvent(pool, claimed);

    expect(await readBack(dead.id)).toMatchObject({ status: 'dead_letter', attempts: 10, last_error: 'One or more integration-event handlers failed', payload: { text: 'badtext' }, processed_at: null });
    expect(await readBack(claimed.id)).toMatchObject({ status: 'processing', lock_owner: 'old-dispatcher', locked_at: at('2026-09-24T10:00:00Z') });
  });

  it('is idempotent: a second insert changes nothing and duplicates no delivery', async () => {
    const row = buildEvent(eventDoc());
    await insertEvent(pool, row);
    await insertEvent(pool, { ...row, status: 'pending' });

    expect((await readBack(row.id)).status).toBe('completed');
    expect((await pool.query('SELECT count(*)::int AS n FROM ops.integration_event_deliveries WHERE integration_event_id = $1', [row.id])).rows[0].n).toBe(2);
  });

  it('inserts an event and its deliveries together, or neither', async () => {
    const first = buildEvent(eventDoc());
    await insertEvent(pool, first);
    // Same eventId under another id: the unique index refuses the event, so none of its deliveries may remain.
    const clash = buildEvent(eventDoc({ eventId: first.event_id }));
    await expect(insertEvent(pool, clash)).rejects.toThrow(/uq_integration_events_event_id|duplicate key/);

    expect((await pool.query('SELECT 1 FROM ops.integration_events WHERE id = $1', [clash.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM ops.integration_event_deliveries WHERE integration_event_id = $1', [clash.id])).rowCount).toBe(0);
  });

  it('reports a malformed id and rejects what Postgres would refuse', () => {
    expect(() => buildEvent(eventDoc({ _id: 'not-an-id' }))).toThrow(BackfillError);
    expect(validateEvent(buildEvent(eventDoc({ status: 'stuck' })))).toMatch(/not a known event status/);
    expect(validateEvent(buildEvent(eventDoc({ eventId: undefined })))).toMatch(/missing eventId/);
    expect(validateEvent(buildEvent(eventDoc({ deliveries: [{ handlerKey: 'h', status: 'lost' }] })))).toMatch(/delivery h has status lost/);
    expect(buildEvent(eventDoc({ attempts: -3, payload: 'not an object' }))).toMatchObject({ attempts: 0, payload: {} });
  });
});
