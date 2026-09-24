/**
 * P8 backfill — Mongo conversation_v2_* → Postgres conversation_v2 schema.
 *
 * Order: sessions → events → app_shares (FK + counter integrity).
 * Ids are preserved (24-char hex); eventSequence/eventCount are copied, not
 * recalculated (listSince depends on wasted sequence slots).
 *
 * Usage:
 *   npx ts-node back/scripts/migrate/2026-10-conversation-v2.ts [--dry-run] [--verify] [--checksum] [--only=sessions|events|app_shares]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, BackfillError, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const isObjectId = (v: unknown): boolean => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);

type Row = Record<string, unknown>;

const s = (v: unknown): string | null => (v == null ? null : String(v));
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const b = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const n = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const toHexId = (v: unknown, label: string, docId: string): string => {
  const raw = v == null ? '' : String(v).toLowerCase();
  if (!isObjectId(raw)) throw new BackfillError(`${label} is not a 24-char hex id`, docId);
  return raw;
};

const toHexIdOrNull = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const raw = String(v).toLowerCase();
  return isObjectId(raw) ? raw : null;
};

const toHexIdArray = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).toLowerCase())
    .filter((x) => isObjectId(x));
};

/** Strip BSON / undefined so jsonb accepts the value. */
const jsonSafe = (v: unknown): Record<string, unknown> => {
  try {
    return JSON.parse(JSON.stringify(v ?? {})) as Record<string, unknown>;
  } catch {
    return {};
  }
};

async function insertRow(pool: Pool, sql: string, values: unknown[]): Promise<void> {
  await pool.query(sql, values);
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(mongoUri);
  const mdb = mongoose.connection.db!;
  const col = (name: string): mongoose.mongo.Collection => mdb.collection(name);

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 5,
  });

  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  const run = (unit: string, fn: () => Promise<void>): Promise<void> =>
    (!only || only === unit) ? fn() : Promise.resolve();

  const sessionIds = new Set<string>(
    (await pool.query('SELECT id FROM conversation_v2.sessions')).rows.map((r) => r.id),
  );

  const STATUS = new Set(['active', 'waiting', 'paused', 'stopped', 'completed', 'error']);
  const DEPLOY = new Set(['idle', 'deploying', 'deployed', 'error']);
  const EVENT_TYPES = new Set([
    'message', 'tool', 'step', 'plan', 'title', 'done', 'wait', 'error',
    'application_component', 'app_build_progress',
  ]);

  // ---- sessions ----------------------------------------------------------
  await run('sessions', async () => {
    let nonHex = 0;
    await runBackfill({
      collection: col('conversation_v2_sessions'),
      build: (doc: MongoDoc): Row => {
        const id = String(doc._id).toLowerCase();
        if (!isObjectId(id)) {
          nonHex += 1;
          throw new BackfillError('session id is not 24-char hex', id);
        }
        const status = String(doc.status ?? 'active');
        const deployStatus = String(doc.deployStatus ?? 'idle');
        if (!STATUS.has(status)) throw new BackfillError(`invalid status ${status}`, id);
        if (!DEPLOY.has(deployStatus)) throw new BackfillError(`invalid deployStatus ${deployStatus}`, id);
        return {
          id,
          owner_id: toHexId(doc.ownerId, 'ownerId', id),
          ai_session_id: s(doc.aiSessionId),
          title: String(doc.title ?? ''),
          status,
          last_event_at: d(doc.lastEventAt) ?? new Date(),
          is_shared: b(doc.isShared),
          share_token_hash: s(doc.shareTokenHash),
          deleted_at: d(doc.deletedAt),
          deploy_status: deployStatus,
          deployed_url: s(doc.deployedUrl),
          deployed_app_title: s(doc.deployedAppTitle),
          last_deployed_at: d(doc.lastDeployedAt),
          last_deployed_revision_id: s(doc.lastDeployedRevisionId),
          has_ai_features: b(doc.hasAiFeatures),
          ai_features_checked_revision_id: s(doc.aiFeaturesCheckedRevisionId),
          workspace_ids: toHexIdArray(doc.workspaceIds),
          selected_skill_ids: toHexIdArray(doc.selectedSkillIds),
          selected_connector_ids: toHexIdArray(doc.selectedConnectorIds),
          event_sequence: n(doc.eventSequence, 0),
          event_count: n(doc.eventCount, 0),
          system_workspace_id: toHexIdOrNull(doc.systemWorkspaceId),
          created_at: d(doc.createdAt) ?? new Date(),
          updated_at: d(doc.updatedAt) ?? new Date(),
        };
      },
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM conversation_v2.sessions WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await insertRow(
          pool,
          `INSERT INTO conversation_v2.sessions (
            id, owner_id, ai_session_id, title, status, last_event_at, is_shared, share_token_hash,
            deleted_at, deploy_status, deployed_url, deployed_app_title, last_deployed_at,
            last_deployed_revision_id, has_ai_features, ai_features_checked_revision_id,
            workspace_ids, selected_skill_ids, selected_connector_ids, event_sequence, event_count,
            system_workspace_id, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
          ) ON CONFLICT (id) DO NOTHING`,
          [
            unit.id, unit.owner_id, unit.ai_session_id, unit.title, unit.status, unit.last_event_at,
            unit.is_shared, unit.share_token_hash, unit.deleted_at, unit.deploy_status,
            unit.deployed_url, unit.deployed_app_title, unit.last_deployed_at,
            unit.last_deployed_revision_id, unit.has_ai_features, unit.ai_features_checked_revision_id,
            unit.workspace_ids, unit.selected_skill_ids, unit.selected_connector_ids,
            unit.event_sequence, unit.event_count, unit.system_workspace_id,
            unit.created_at, unit.updated_at,
          ],
        );
        sessionIds.add(unit.id as string);
      },
      verify: async (units) => {
        const map = new Map<string, string>();
        for (const unit of units) {
          const r = await pool.query(
            'SELECT event_sequence, event_count, owner_id FROM conversation_v2.sessions WHERE id = $1',
            [String(unit.id)],
          );
          if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
          else if (Number(r.rows[0].event_sequence) !== Number(unit.event_sequence)) {
            map.set(String(unit.id), 'event_sequence mismatch');
          } else if (Number(r.rows[0].event_count) !== Number(unit.event_count)) {
            map.set(String(unit.id), 'event_count mismatch');
          }
        }
        return map;
      },
      pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM conversation_v2.sessions')).rows[0].n,
      pgIds: async () => (await pool.query('SELECT id FROM conversation_v2.sessions')).rows.map((r) => r.id),
      checksumRows: async (ids) => {
        const r = await pool.query(
          `SELECT id, owner_id, ai_session_id, title, status, event_sequence, event_count, is_shared
           FROM conversation_v2.sessions WHERE id = ANY($1::char(24)[])`,
          [ids],
        );
        return new Map(r.rows.map((row) => [row.id, row as Record<string, unknown>]));
      },
    });
    if (nonHex > 0) console.warn(JSON.stringify({ label: 'sessions non-24-hex ids skipped', count: nonHex }));
  });

  // Refresh session id set after sessions unit (needed for --only=events)
  for (const id of (await pool.query('SELECT id FROM conversation_v2.sessions')).rows.map((r) => r.id)) {
    sessionIds.add(id);
  }

  // ---- events ------------------------------------------------------------
  await run('events', async () => {
    let orphan = 0;
    let sessionsWithoutEventsReport = 0;
    await runBackfill({
      collection: col('conversation_v2_events'),
      build: (doc: MongoDoc): Row => {
        const id = String(doc._id).toLowerCase();
        if (!isObjectId(id)) throw new BackfillError('event id is not 24-char hex', id);
        const sessionId = toHexId(doc.sessionId, 'sessionId', id);
        if (!sessionIds.has(sessionId)) {
          orphan += 1;
          throw new BackfillError(`orphan event: session ${sessionId} missing`, id);
        }
        const type = String(doc.type ?? '');
        if (!EVENT_TYPES.has(type)) throw new BackfillError(`invalid event type ${type}`, id);
        const eventId = String(doc.eventId ?? '');
        if (!eventId) throw new BackfillError('missing eventId', id);
        return {
          id,
          session_id: sessionId,
          sequence: n(doc.sequence, -1),
          event_id: eventId,
          type,
          emitted_at: n(doc.emittedAt, 0),
          payload: jsonSafe(doc.payload),
          model_id: s(doc.modelId),
          created_at: d(doc.createdAt) ?? new Date(),
        };
      },
      validate: (unit) => (Number(unit.sequence) < 0 ? 'missing sequence' : null),
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM conversation_v2.events WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await insertRow(
          pool,
          `INSERT INTO conversation_v2.events (
            id, session_id, sequence, event_id, type, emitted_at, payload, model_id, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
          [
            unit.id, unit.session_id, unit.sequence, unit.event_id, unit.type,
            unit.emitted_at, JSON.stringify(unit.payload), unit.model_id, unit.created_at,
          ],
        );
      },
      verify: async (units) => {
        const map = new Map<string, string>();
        for (const unit of units) {
          const r = await pool.query(
            'SELECT session_id, sequence, event_id, type FROM conversation_v2.events WHERE id = $1',
            [String(unit.id)],
          );
          if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
          else if (r.rows[0].event_id !== unit.event_id) map.set(String(unit.id), 'event_id mismatch');
          else if (Number(r.rows[0].sequence) !== Number(unit.sequence)) {
            map.set(String(unit.id), 'sequence mismatch');
          }
        }
        return map;
      },
      checksumRows: async (ids) => {
        const r = await pool.query(
          `SELECT id, session_id, sequence, event_id, type, emitted_at, payload, model_id
           FROM conversation_v2.events WHERE id = ANY($1::char(24)[])`,
          [ids],
        );
        return new Map(
          r.rows.map((row) => [
            row.id,
            {
              ...row,
              payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            } as Record<string, unknown>,
          ]),
        );
      },
      pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM conversation_v2.events')).rows[0].n,
      pgIds: async () => (await pool.query('SELECT id FROM conversation_v2.events')).rows.map((r) => r.id),
      progressEvery: 2000,
    });

    const empty = await pool.query(`
      SELECT s.id FROM conversation_v2.sessions s
      LEFT JOIN conversation_v2.events e ON e.session_id = s.id
      WHERE e.id IS NULL AND s.event_count > 0
      LIMIT 50
    `);
    sessionsWithoutEventsReport = empty.rowCount ?? 0;
    console.warn(JSON.stringify({
      label: 'events orphan skipped / sessions with event_count>0 but no events in PG',
      orphanEvents: orphan,
      sessionsMissingEventsSample: sessionsWithoutEventsReport,
      sample: empty.rows.map((r) => r.id),
    }));
  });

  // ---- app_shares --------------------------------------------------------
  await run('app_shares', async () => {
    let orphanShares = 0;
    let dupEmails = 0;
    const seenEmailKeys = new Set<string>();
    await runBackfill({
      collection: col('conversation_v2_app_shares'),
      build: (doc: MongoDoc): Row => {
        const id = String(doc._id).toLowerCase();
        if (!isObjectId(id)) throw new BackfillError('share id is not 24-char hex', id);
        const sessionId = toHexId(doc.sessionId, 'sessionId', id);
        if (!sessionIds.has(sessionId)) {
          orphanShares += 1;
          throw new BackfillError(`orphan share: session ${sessionId} missing`, id);
        }
        const email = doc.recipientEmail == null
          ? null
          : String(doc.recipientEmail).trim().toLowerCase() || null;
        if (email) {
          const key = `${sessionId}:${email}`;
          if (seenEmailKeys.has(key)) {
            dupEmails += 1;
            throw new BackfillError(`duplicate (session, email)=${key}`, id);
          }
          seenEmailKeys.add(key);
        }
        return {
          id,
          session_id: sessionId,
          owner_id: toHexId(doc.ownerId, 'ownerId', id),
          recipient_user_id: toHexIdOrNull(doc.recipientUserId),
          recipient_email: email,
          title: String(doc.title ?? ''),
          deployed_url: String(doc.deployedUrl ?? ''),
          last_deployed_at: d(doc.lastDeployedAt),
          include_conversation: b(doc.includeConversation, true),
          invite_token_hash: s(doc.inviteTokenHash),
          invite_expires_at: d(doc.inviteExpiresAt),
          invite_consumed_at: d(doc.inviteConsumedAt),
          created_at: d(doc.createdAt) ?? new Date(),
          updated_at: d(doc.updatedAt) ?? new Date(),
        };
      },
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM conversation_v2.app_shares WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await insertRow(
          pool,
          `INSERT INTO conversation_v2.app_shares (
            id, session_id, owner_id, recipient_user_id, recipient_email, title, deployed_url,
            last_deployed_at, include_conversation, invite_token_hash, invite_expires_at,
            invite_consumed_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
          [
            unit.id, unit.session_id, unit.owner_id, unit.recipient_user_id, unit.recipient_email,
            unit.title, unit.deployed_url, unit.last_deployed_at, unit.include_conversation,
            unit.invite_token_hash, unit.invite_expires_at, unit.invite_consumed_at,
            unit.created_at, unit.updated_at,
          ],
        );
      },
      verify: async (units) => {
        const map = new Map<string, string>();
        for (const unit of units) {
          const r = await pool.query(
            'SELECT session_id, recipient_email FROM conversation_v2.app_shares WHERE id = $1',
            [String(unit.id)],
          );
          if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        }
        return map;
      },
      pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM conversation_v2.app_shares')).rows[0].n,
      pgIds: async () => (await pool.query('SELECT id FROM conversation_v2.app_shares')).rows.map((r) => r.id),
    });
    console.warn(JSON.stringify({
      label: 'app_shares orphans / duplicate emails skipped',
      orphanShares,
      dupEmails,
    }));
  });

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
