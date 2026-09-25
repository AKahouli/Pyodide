/**
 * P8 backfill — Mongo app-runtime + ai_preview_tickets → Postgres app_runtime schema.
 *
 * Durable tables: bindings, source_revisions, finalized_revisions, tool_calls.
 * Ephemeral (tickets, ai_preview_tickets) skipped by default — use --only= to include.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-app-runtime.ts [--dry-run] [--verify] [--only=bindings|source_revisions|finalized_revisions|tool_calls|tickets|ai_preview_tickets]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { stripNul } from '../../src/common/postgres/json';
import { runBackfill, BackfillError, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

type Row = Record<string, unknown>;

const s = (v: unknown): string | null => (v == null ? null : String(v));
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const n = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function newObjectId(): string {
  const bytes = Buffer.alloc(12);
  require('crypto').randomFillSync(bytes);
  return bytes.toString('hex');
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

  // Ensure the schema exists.
  await pool.query('CREATE SCHEMA IF NOT EXISTS app_runtime');

  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  const run = (unit: string, fn: () => Promise<void>): Promise<void> =>
    !only || only === unit ? fn() : Promise.resolve();

  // ---- bindings ----------------------------------------------------------
  await run('bindings', async () => {
    await runBackfill({
      collection: col('app_runtime_bindings'),
      build: (doc: MongoDoc): Row => {
        const bindingId = String(doc.bindingId ?? '');
        if (!bindingId) throw new BackfillError('missing bindingId', String(doc._id));
        return {
          binding_id: bindingId,
          workspace_id: String(doc.workspaceId ?? ''),
          conversation_session_id: String(doc.conversationSessionId ?? ''),
          user_id: String(doc.userId ?? ''),
          status: String(doc.status ?? 'created'),
          latest_revision_id: String(doc.latestRevisionId ?? 'starter_react_vite_v6'),
          mcp_token_hash: String(doc.mcpTokenHash ?? ''),
          browser_runtime_id: s(doc.browserRuntimeId),
          browser_capabilities: doc.browserCapabilities != null ? JSON.stringify(doc.browserCapabilities) : null,
          last_heartbeat_at: d(doc.lastHeartbeatAt),
          created_at: d(doc.createdAt) ?? new Date(),
          updated_at: d(doc.updatedAt) ?? new Date(),
        };
      },
      unitId: (unit) => unit.binding_id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM app_runtime.bindings WHERE binding_id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await pool.query(
          `INSERT INTO app_runtime.bindings (
            binding_id, workspace_id, conversation_session_id, user_id, status,
            latest_revision_id, mcp_token_hash, browser_runtime_id, browser_capabilities,
            last_heartbeat_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
          ON CONFLICT (binding_id) DO NOTHING`,
          [
            unit.binding_id, unit.workspace_id, unit.conversation_session_id, unit.user_id,
            unit.status, unit.latest_revision_id, unit.mcp_token_hash, unit.browser_runtime_id,
            unit.browser_capabilities, unit.last_heartbeat_at, unit.created_at, unit.updated_at,
          ],
        );
      },
      pgCount: async () =>
        (await pool.query('SELECT count(*)::int AS n FROM app_runtime.bindings')).rows[0].n,
    });
  });

  // ---- source_revisions --------------------------------------------------
  await run('source_revisions', async () => {
    await runBackfill({
      collection: col('app_source_revisions'),
      build: (doc: MongoDoc): Row => {
        const id = String(doc._id).toLowerCase();
        return {
          id: /^[0-9a-f]{24}$/.test(id) ? id : newObjectId(),
          revision_id: String(doc.revisionId ?? ''),
          workspace_id: String(doc.workspaceId ?? ''),
          parent_revision_id: s(doc.parentRevisionId),
          manifest_hash: String(doc.manifestHash ?? ''),
          manifest_object_key: String(doc.manifestObjectKey ?? ''),
          files: JSON.stringify(Array.isArray(doc.files) ? doc.files : []),
          created_by_tool_call_id: s(doc.createdByToolCallId),
          created_at: d(doc.createdAt) ?? new Date(),
          updated_at: d(doc.updatedAt) ?? new Date(),
        };
      },
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM app_runtime.source_revisions WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await pool.query(
          `INSERT INTO app_runtime.source_revisions (
            id, revision_id, workspace_id, parent_revision_id, manifest_hash,
            manifest_object_key, files, created_by_tool_call_id, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
          ON CONFLICT (id) DO NOTHING`,
          [
            unit.id, unit.revision_id, unit.workspace_id, unit.parent_revision_id,
            unit.manifest_hash, unit.manifest_object_key, unit.files,
            unit.created_by_tool_call_id, unit.created_at, unit.updated_at,
          ],
        );
      },
      pgCount: async () =>
        (await pool.query('SELECT count(*)::int AS n FROM app_runtime.source_revisions')).rows[0].n,
    });
  });

  // ---- finalized_revisions -----------------------------------------------
  await run('finalized_revisions', async () => {
    await runBackfill({
      collection: col('app_finalized_revisions'),
      build: (doc: MongoDoc): Row => {
        const id = String(doc._id).toLowerCase();
        return {
          id: /^[0-9a-f]{24}$/.test(id) ? id : newObjectId(),
          workspace_id: String(doc.workspaceId ?? ''),
          revision_id: String(doc.revisionId ?? ''),
          title: String(doc.title ?? ''),
          finalized_at: d(doc.finalizedAt) ?? new Date(),
          event_id: String(doc.eventId ?? ''),
          file_count: typeof doc.fileCount === 'number' ? doc.fileCount : null,
          ceph_manifest_path: s(doc.cephManifestPath),
          created_at: d(doc.createdAt) ?? new Date(),
          updated_at: d(doc.updatedAt) ?? new Date(),
        };
      },
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM app_runtime.finalized_revisions WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await pool.query(
          `INSERT INTO app_runtime.finalized_revisions (
            id, workspace_id, revision_id, title, finalized_at, event_id,
            file_count, ceph_manifest_path, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (id) DO NOTHING`,
          [
            unit.id, unit.workspace_id, unit.revision_id, unit.title, unit.finalized_at,
            unit.event_id, unit.file_count, unit.ceph_manifest_path,
            unit.created_at, unit.updated_at,
          ],
        );
      },
      pgCount: async () =>
        (await pool.query('SELECT count(*)::int AS n FROM app_runtime.finalized_revisions')).rows[0].n,
    });
  });

  // ---- tool_calls --------------------------------------------------------
  await run('tool_calls', async () => {
    await runBackfill({
      collection: col('app_runtime_tool_calls'),
      build: (doc: MongoDoc): Row => {
        const toolCallId = String(doc.toolCallId ?? '');
        if (!toolCallId) throw new BackfillError('missing toolCallId', String(doc._id));
        return {
          tool_call_id: toolCallId,
          binding_id: String(doc.bindingId ?? ''),
          workspace_id: String(doc.workspaceId ?? ''),
          tool: String(doc.tool ?? ''),
          arguments_hash: String(doc.argumentsHash ?? ''),
          base_revision_id: s(doc.baseRevisionId),
          status: String(doc.status ?? 'pending'),
          result: doc.result != null ? JSON.stringify(stripNul(doc.result)) : null,
          error: doc.error != null ? JSON.stringify(stripNul(doc.error)) : null,
          resulting_revision_id: s(doc.resultingRevisionId),
          started_at_ms: typeof doc.startedAtMs === 'number' ? doc.startedAtMs : null,
          duration_ms: typeof doc.durationMs === 'number' ? doc.durationMs : null,
          created_at: d(doc.createdAt) ?? new Date(),
          updated_at: d(doc.updatedAt) ?? new Date(),
        };
      },
      unitId: (unit) => unit.tool_call_id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM app_runtime.tool_calls WHERE tool_call_id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await pool.query(
          `INSERT INTO app_runtime.tool_calls (
            tool_call_id, binding_id, workspace_id, tool, arguments_hash,
            base_revision_id, status, result, error, resulting_revision_id,
            started_at_ms, duration_ms, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14)
          ON CONFLICT (tool_call_id) DO NOTHING`,
          [
            unit.tool_call_id, unit.binding_id, unit.workspace_id, unit.tool,
            unit.arguments_hash, unit.base_revision_id, unit.status, unit.result,
            unit.error, unit.resulting_revision_id, unit.started_at_ms, unit.duration_ms,
            unit.created_at, unit.updated_at,
          ],
        );
      },
      pgCount: async () =>
        (await pool.query('SELECT count(*)::int AS n FROM app_runtime.tool_calls')).rows[0].n,
    });
  });

  // ---- tickets (ephemeral, skipped by default) ---------------------------
  await run('tickets', async () => {
    console.log('Backfilling ephemeral app_runtime_tickets (usually not needed)...');
    await runBackfill({
      collection: col('app_runtime_tickets'),
      build: (doc: MongoDoc): Row => ({
        runtime_session_id: String(doc.runtimeSessionId ?? ''),
        ticket_hash: String(doc.ticketHash ?? ''),
        binding_id: String(doc.bindingId ?? ''),
        workspace_id: String(doc.workspaceId ?? ''),
        user_id: String(doc.userId ?? ''),
        expires_at: d(doc.expiresAt) ?? new Date(),
        consumed_at: d(doc.consumedAt),
        created_at: d(doc.createdAt) ?? new Date(),
        updated_at: d(doc.updatedAt) ?? new Date(),
      }),
      unitId: (unit) => unit.runtime_session_id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM app_runtime.tickets WHERE runtime_session_id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await pool.query(
          `INSERT INTO app_runtime.tickets (
            runtime_session_id, ticket_hash, binding_id, workspace_id, user_id,
            expires_at, consumed_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (runtime_session_id) DO NOTHING`,
          [
            unit.runtime_session_id, unit.ticket_hash, unit.binding_id, unit.workspace_id,
            unit.user_id, unit.expires_at, unit.consumed_at, unit.created_at, unit.updated_at,
          ],
        );
      },
      pgCount: async () =>
        (await pool.query('SELECT count(*)::int AS n FROM app_runtime.tickets')).rows[0].n,
    });
  });

  // ---- ai_preview_tickets (ephemeral, skipped by default) ----------------
  await run('ai_preview_tickets', async () => {
    console.log('Backfilling ephemeral ai_preview_tickets (usually not needed)...');
    await runBackfill({
      collection: col('ai_preview_tickets'),
      build: (doc: MongoDoc): Row => {
        const id = String(doc._id).toLowerCase();
        return {
          id: /^[0-9a-f]{24}$/.test(id) ? id : newObjectId(),
          ticket_hash: String(doc.ticketHash ?? ''),
          conversation_session_id: String(doc.conversationSessionId ?? ''),
          workspace_id: String(doc.workspaceId ?? ''),
          binding_id: String(doc.bindingId ?? ''),
          billable_user_id: String(doc.billableUserId ?? ''),
          purpose: String(doc.purpose ?? 'ai_preview'),
          expires_at: d(doc.expiresAt) ?? new Date(),
          created_at: d(doc.createdAt) ?? new Date(),
          updated_at: d(doc.updatedAt) ?? new Date(),
        };
      },
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM app_runtime.ai_preview_tickets WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await pool.query(
          `INSERT INTO app_runtime.ai_preview_tickets (
            id, ticket_hash, conversation_session_id, workspace_id, binding_id,
            billable_user_id, purpose, expires_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (id) DO NOTHING`,
          [
            unit.id, unit.ticket_hash, unit.conversation_session_id, unit.workspace_id,
            unit.binding_id, unit.billable_user_id, unit.purpose, unit.expires_at,
            unit.created_at, unit.updated_at,
          ],
        );
      },
      pgCount: async () =>
        (await pool.query('SELECT count(*)::int AS n FROM app_runtime.ai_preview_tickets')).rows[0].n,
    });
  });

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
