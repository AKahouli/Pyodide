/**
 * Mongo → Postgres mapping of the playbook-flow idempotency records (roadmap P5):
 * flowidempotencyrecords → playbook.idempotency_records.
 * Kept apart from the runner so a spec can drive the same mapping, validation and insert with
 * fabricated documents.
 *
 * A unit is one Postgres row keyed by the Postgres column names; `IDEMPOTENCY_COLUMNS` is both the
 * insert list and the checksum read-back list.
 *
 *   - Only records that have not expired are migrated (`liveIdempotencyFilter`): an expired one is what
 *     Mongo's TTL monitor deletes, and Postgres would treat it as absent anyway.
 *   - `execution_id` is a soft reference (no foreign key): a record whose execution is gone is kept
 *     as is, it still answers a retry of its key until it expires.
 *   - flowexecutionleases is deliberately NOT migrated: a lease is a transient concurrency slot
 *     (two-minute TTL kept alive by the heartbeat of a running execution) and no execution runs
 *     across the cutover restart; the dev collection is empty.
 */
import { stripNul } from '../../src/common/postgres/json';
import { BackfillError, type MongoDoc } from './harness';

export type Row = Record<string, unknown>;

export interface Queryable {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}

export const IDEMPOTENCY_TABLE = 'playbook.idempotency_records';
export const IDEMPOTENCY_COLLECTION = 'flowidempotencyrecords';
export const LEASE_COLLECTION = 'flowexecutionleases';

export const IDEMPOTENCY_COLUMNS = [
  'id', 'owner_id', 'idempotency_key', 'payload_hash', 'execution_id', 'response_body', 'expected_state_hash',
  'expected_definition_revision', 'expires_at', 'created_at', 'updated_at',
];

const HEX = /^[0-9a-f]{24}$/;
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const s = (v: unknown): string | null => (v == null ? null : stripNul(String(v)));
const sReq = (v: unknown): string => stripNul(String(v ?? ''));
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const hexId = (v: unknown, label: string, docId: string): string => {
  const raw = v == null ? '' : String(v).toLowerCase();
  if (!HEX.test(raw)) throw new BackfillError(`${label} is not a 24-char hex id`, docId);
  return raw;
};
/** The stored response body, as jsonb keeps it: plain JSON (dates as ISO strings), no U+0000. */
const jsonOrNull = (v: unknown): Record<string, unknown> | null => {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return null;
  const parsed = stripNul(JSON.parse(JSON.stringify(v)) as unknown);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
};

/** The Mongo filter of the records to migrate: those still live at `now`. */
export const liveIdempotencyFilter = (now = new Date()): Record<string, unknown> => ({ expiresAt: { $gt: now } });

export const buildIdempotencyRecord = (doc: MongoDoc): Row => {
  const id = hexId(doc._id, '_id', String(doc._id));
  const expiresAt = d(doc.expiresAt);
  if (!expiresAt) throw new BackfillError('expiresAt is missing or not a date', id);
  const now = new Date();
  return {
    id,
    owner_id: hexId(doc.ownerId, 'ownerId', id),
    idempotency_key: sReq(doc.idempotencyKey),
    payload_hash: sReq(doc.payloadHash),
    execution_id: doc.executionId == null || doc.executionId === '' ? null : hexId(doc.executionId, 'executionId', id),
    response_body: jsonOrNull(doc.responseBody),
    expected_state_hash: s(doc.expectedStateHash),
    expected_definition_revision: int(doc.expectedDefinitionRevision),
    expires_at: expiresAt,
    created_at: d(doc.createdAt) ?? now,
    updated_at: d(doc.updatedAt) ?? d(doc.createdAt) ?? now,
  };
};

export const validateIdempotencyRecord = (row: Row): string | null => {
  if (!row.idempotency_key) return 'idempotencyKey is empty';
  if (!row.payload_hash) return 'payloadHash is empty';
  return null;
};

/**
 * INSERT ... ON CONFLICT (id) DO NOTHING: a re-run inserts nothing. A live record the application
 * already wrote for the same (owner, key) is a unique violation, recorded as a failure of that row.
 */
export async function insertIdempotencyRecord(pool: Queryable, row: Row): Promise<void> {
  await pool.query(
    `INSERT INTO ${IDEMPOTENCY_TABLE} (${IDEMPOTENCY_COLUMNS.join(', ')}) VALUES (${IDEMPOTENCY_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    IDEMPOTENCY_COLUMNS.map((c) => (c === 'response_body' && row[c] !== null ? JSON.stringify(row[c]) : row[c])),
  );
}
