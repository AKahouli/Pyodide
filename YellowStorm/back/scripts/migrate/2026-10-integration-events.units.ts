/**
 * Mongo → Postgres mapping of the integration_events outbox (roadmap P6).
 * Kept apart from the runner so a spec can drive the same mapping and insert with fabricated documents.
 *
 * An event row uses the Postgres column names as keys. Its embedded `deliveries` array becomes rows of
 * ops.integration_event_deliveries and travels on the row as a non-enumerable property, so the content
 * checksum (which compares the enumerable columns) is not thrown off by it.
 */
import { stripNul } from '../../src/common/postgres/json';
import { BackfillError, type MongoDoc } from './harness';

export type Row = Record<string, unknown>;

export interface DeliveryRow {
  integration_event_id: string;
  handler_key: string;
  status: string;
  attempts: number;
  last_error: string | null;
  completed_at: Date | null;
}

export const EVENT_COLUMNS = [
  'id', 'event_id', 'event_type', 'aggregate_type', 'aggregate_id', 'payload', 'occurred_at', 'status', 'attempts',
  'next_attempt_at', 'locked_at', 'lock_owner', 'processed_at', 'last_error', 'correlation_id', 'causation_id', 'created_at', 'updated_at',
];
export const DELIVERY_COLUMNS = ['integration_event_id', 'handler_key', 'status', 'attempts', 'last_error', 'completed_at'];

const HEX = /^[0-9a-f]{24}$/;
const EVENT_STATUSES = ['pending', 'processing', 'completed', 'failed', 'dead_letter'];
const DELIVERY_STATUSES = ['pending', 'completed', 'failed'];

const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const s = (v: unknown): string | null => (v == null ? null : stripNul(String(v)));
const sReq = (v: unknown): string => stripNul(String(v ?? ''));
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);
/** Strip BSON / undefined / U+0000 so jsonb accepts the value; Dates become ISO strings, as the outbox now writes them. */
const json = (v: unknown): Record<string, unknown> => {
  try {
    const parsed = stripNul(JSON.parse(JSON.stringify(v ?? {})) as unknown);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const buildEvent = (doc: MongoDoc): Row => {
  const id = String(doc._id ?? '').toLowerCase();
  if (!HEX.test(id)) throw new BackfillError('_id is not a 24-char hex id', String(doc._id));
  const now = new Date();
  const row: Row = {
    id,
    event_id: sReq(doc.eventId),
    event_type: sReq(doc.eventType),
    aggregate_type: sReq(doc.aggregateType),
    aggregate_id: sReq(doc.aggregateId),
    payload: json(doc.payload),
    occurred_at: d(doc.occurredAt) ?? d(doc.createdAt) ?? now,
    status: sReq(doc.status ?? 'pending'),
    attempts: count(doc.attempts),
    next_attempt_at: d(doc.nextAttemptAt),
    locked_at: d(doc.lockedAt),
    lock_owner: s(doc.lockOwner),
    processed_at: d(doc.processedAt),
    last_error: s(doc.lastError),
    correlation_id: s(doc.correlationId),
    causation_id: s(doc.causationId),
    created_at: d(doc.createdAt) ?? now,
    updated_at: d(doc.updatedAt) ?? now,
  };
  const deliveries: DeliveryRow[] = (Array.isArray(doc.deliveries) ? (doc.deliveries as MongoDoc[]) : []).map((delivery) => ({
    integration_event_id: id,
    handler_key: sReq(delivery.handlerKey),
    status: sReq(delivery.status ?? 'pending'),
    attempts: count(delivery.attempts),
    last_error: s(delivery.lastError),
    completed_at: d(delivery.completedAt),
  }));
  Object.defineProperty(row, 'deliveries', { value: deliveries, enumerable: false });
  return row;
};

export const deliveriesOf = (row: Row): DeliveryRow[] => ((row as { deliveries?: DeliveryRow[] }).deliveries ?? []);

export const validateEvent = (row: Row): string | null => {
  if (!row.event_id || !row.event_type || !row.aggregate_type || !row.aggregate_id) return 'event is missing eventId, eventType, aggregateType or aggregateId';
  if (!EVENT_STATUSES.includes(String(row.status))) return `status ${String(row.status)} is not a known event status`;
  const badDelivery = deliveriesOf(row).find((delivery) => !delivery.handler_key || !DELIVERY_STATUSES.includes(delivery.status));
  return badDelivery ? `delivery ${badDelivery.handler_key || '(no handler key)'} has status ${badDelivery.status}` : null;
};

export interface Client {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
}
export interface ClientPool {
  connect: () => Promise<Client>;
}

/** One event and its deliveries in one transaction; a second run of the same id inserts nothing. */
export async function insertEvent(pool: ClientPool, row: Row): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const values = EVENT_COLUMNS.map((column) => (column === 'payload' ? JSON.stringify(row.payload) : row[column]));
    const inserted = (await client.query(
      `INSERT INTO ops.integration_events (${EVENT_COLUMNS.join(', ')}) VALUES (${EVENT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
      values,
    )) as { rowCount: number | null };
    if (inserted.rowCount) {
      for (const delivery of deliveriesOf(row)) {
        await client.query(
          `INSERT INTO ops.integration_event_deliveries (${DELIVERY_COLUMNS.join(', ')}) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (integration_event_id, handler_key) DO NOTHING`,
          DELIVERY_COLUMNS.map((column) => (delivery as unknown as Row)[column]),
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
