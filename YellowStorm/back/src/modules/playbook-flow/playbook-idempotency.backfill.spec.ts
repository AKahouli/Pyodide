import { inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { isUniqueViolation, newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import * as u from '../../../scripts/migrate/2026-10-playbook-idempotency.units';
import type { Row } from '../../../scripts/migrate/2026-10-playbook-idempotency.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import { IdempotencyRepository } from './persistence/idempotency.repository';

/**
 * Drives the idempotency backfill mapping, validation and insert with fabricated Mongo-shaped
 * documents (the dev collection holds only a few live records) and checks every migrated row reads
 * back identical, then that the repository serves it like a record the application wrote.
 */
describeIntegration('playbook idempotency backfill mapping (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const oid = (): string => newObjectId();
  const objectId = (hex: string): Types.ObjectId => new Types.ObjectId(hex);
  const repository = new IdempotencyRepository(db as never);

  const ownerId = oid();
  const goneExecutionId = oid(); // never inserted: executions are a soft reference here
  const inFuture = new Date(Date.now() + 6 * 60 * 60 * 1000);

  afterAll(async () => {
    await db.delete(schema.playbookIdempotencyRecords).where(inArray(schema.playbookIdempotencyRecords.ownerId, [ownerId]));
    await close();
  });

  const doc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: objectId(oid()),
    ownerId,
    idempotencyKey: `key-${oid()}`,
    payloadHash: 'f'.repeat(64),
    expiresAt: inFuture,
    createdAt: new Date('2026-09-25T08:00:00Z'),
    updatedAt: new Date('2026-09-25T08:00:01Z'),
    __v: 0,
    ...over,
  });
  const readBack = async (id: unknown): Promise<Row> => {
    const back = await pool.query(`SELECT ${u.IDEMPOTENCY_COLUMNS.join(', ')} FROM ${u.IDEMPOTENCY_TABLE} WHERE id = $1`, [id]);
    expect(back.rows).toHaveLength(1);
    return back.rows[0] as Row;
  };
  const roundTrip = async (row: Row): Promise<Row> => {
    expect(u.validateIdempotencyRecord(row)).toBeNull();
    await u.insertIdempotencyRecord(pool, row);
    const back = await readBack(row.id);
    expect(compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), back]]))).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 });
    return back;
  };

  it('migrates a completed save record with its response body and expected state', async () => {
    const source = doc({
      responseBody: { id: oid(), definitionRevision: 3, applied: true, updatedAt: new Date('2026-09-25T08:00:02Z'), note: 'nul\u0000byte' },
      expectedStateHash: 'state-hash',
      expectedDefinitionRevision: 3,
    });
    const row = u.buildIdempotencyRecord(source);

    expect(row).toMatchObject({
      owner_id: ownerId, execution_id: null, expected_state_hash: 'state-hash', expected_definition_revision: 3, expires_at: inFuture,
      response_body: { definitionRevision: 3, applied: true, updatedAt: '2026-09-25T08:00:02.000Z', note: 'nulbyte' },
    });
    await roundTrip(row);

    const served = await repository.findLive(ownerId, String(source.idempotencyKey));
    expect(served).toMatchObject({ id: row.id, payloadHash: 'f'.repeat(64), responseBody: row.response_body, expectedDefinitionRevision: 3 });
  });

  it('keeps a record whose execution is gone, the execution id as a soft reference', async () => {
    const row = u.buildIdempotencyRecord(doc({ executionId: goneExecutionId.toUpperCase() }));

    expect(row.execution_id).toBe(goneExecutionId);
    await roundTrip(row);
  });

  it('migrates a reservation still waiting for its execution with empty optional fields', async () => {
    const row = u.buildIdempotencyRecord(doc({ _id: objectId(oid()), executionId: undefined, responseBody: undefined }));

    expect(row).toMatchObject({ execution_id: null, response_body: null, expected_state_hash: null, expected_definition_revision: null });
    const back = await roundTrip(row);
    expect(back.created_at).toEqual(new Date('2026-09-25T08:00:00Z'));
  });

  it('is idempotent: a second insert of the same id changes nothing', async () => {
    const row = u.buildIdempotencyRecord(doc());
    await u.insertIdempotencyRecord(pool, row);

    await u.insertIdempotencyRecord(pool, { ...row, payload_hash: 'changed' });

    expect((await readBack(row.id)).payload_hash).toBe('f'.repeat(64));
  });

  it('reports a record whose key the application already holds under another id', async () => {
    const source = doc();
    await u.insertIdempotencyRecord(pool, u.buildIdempotencyRecord(source));
    const clash = u.buildIdempotencyRecord({ ...source, _id: objectId(oid()) });

    const error = await u.insertIdempotencyRecord(pool, clash).catch((e: unknown) => e);

    expect(isUniqueViolation(error, 'uq_playbook_idempotency_records_key')).toBe(true);
  });

  it('refuses documents whose ids or expiry cannot be stored', () => {
    expect(() => u.buildIdempotencyRecord(doc({ ownerId: 'user-1' }))).toThrow(BackfillError);
    expect(() => u.buildIdempotencyRecord(doc({ executionId: 'exec-1' }))).toThrow('executionId is not a 24-char hex id');
    expect(() => u.buildIdempotencyRecord(doc({ expiresAt: undefined }))).toThrow('expiresAt is missing');
  });

  it('reports a record without key or payload hash', () => {
    expect(u.validateIdempotencyRecord(u.buildIdempotencyRecord(doc({ idempotencyKey: '' })))).toBe('idempotencyKey is empty');
    expect(u.validateIdempotencyRecord(u.buildIdempotencyRecord(doc({ payloadHash: undefined })))).toBe('payloadHash is empty');
  });

  it('selects only the records that have not expired', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    expect(u.liveIdempotencyFilter(now)).toEqual({ expiresAt: { $gt: now } });
  });
});
