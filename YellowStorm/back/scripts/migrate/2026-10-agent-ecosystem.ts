/**
 * Step 4 backfill — Mongo → Postgres agent ecosystem (plan 4.11/4.15).
 *   agent_telegram_integrations → channels.telegram_integrations
 *   telegram_chat_bindings      → channels.telegram_chat_bindings
 *   widget_tokens               → channels.widget_tokens
 * Skipped by decision: WhatsApp collections (Baileys channel deprecated, stays
 * Mongo until removal) and telegram_link_codes (fresh, 15-minute TTL).
 * Widget sessions/messages start fresh (plan 4.15).
 * encrypted_bot_token / token_hash are copied byte-exact (--checksum covers them).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-agent-ecosystem.ts [--dry-run] [--verify] [--checksum]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v == null ? null : String(v));
const dateOf = (v: unknown): Date | null => (v ? new Date(String(v)) : null);

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const mdb = mongoose.connection.db!;

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 5,
  });

  // Mongo stores some *_id fields as ObjectIds and some as strings, so $in
  // filters silently mismatch; scan unfiltered and validate membership instead
  // so orphans show up as reported failures.
  const pgAgentIds = new Set((await pool.query('SELECT id FROM public.agents')).rows.map((r) => r.id));

  // ── channels.telegram_integrations ──────────────────────────────────
  // Mongo collection is agent_telegram_integrations (the empty
  // telegram_integrations collection is a dead leftover).
  await runBackfill({
    collection: mdb.collection('agent_telegram_integrations'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      user_id: String(doc.userId),
      agent_id: String(doc.agentId),
      encrypted_bot_token: String(doc.encryptedBotToken),
      bot_username: s(doc.botUsername),
      webhook_secret: String(doc.webhookSecret),
      enabled: doc.enabled !== false,
      status: String(doc.status ?? 'pending'),
      error_message: s(doc.errorMessage),
      last_webhook_at: dateOf(doc.lastWebhookAt),
      last_update_id: typeof doc.lastUpdateId === 'number' ? doc.lastUpdateId : null,
      created_at: dateOf(doc.createdAt) ?? new Date(),
      updated_at: dateOf(doc.updatedAt) ?? new Date(),
    }),
    validate: (unit) => (!pgAgentIds.has(String(unit.agent_id))
      ? `dangling agent_id ${unit.agent_id} (agent gone from PG; FK would reject)`
      : null),
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM channels.telegram_integrations WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO channels.telegram_integrations
           (id, user_id, agent_id, encrypted_bot_token, bot_username, webhook_secret, enabled,
            status, error_message, last_webhook_at, last_update_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.user_id, unit.agent_id, unit.encrypted_bot_token, unit.bot_username,
         unit.webhook_secret, unit.enabled, unit.status, unit.error_message,
         unit.last_webhook_at, unit.last_update_id, unit.created_at, unit.updated_at],
      );
    },
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM channels.telegram_integrations WHERE id = ANY($1)', [ids]);
      // node-postgres returns bigint as string; the unit carries a number.
      return new Map(r.rows.map((row) => [row.id, {
        ...row,
        last_update_id: row.last_update_id == null ? null : Number(row.last_update_id),
      }]));
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM channels.telegram_integrations')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM channels.telegram_integrations')).rows.map((r) => r.id),
  });

  const pgIntegrationIds = new Set((await pool.query('SELECT id FROM channels.telegram_integrations')).rows.map((r) => r.id));

  // ── channels.telegram_chat_bindings ─────────────────────────────────
  await runBackfill({
    collection: mdb.collection('telegram_chat_bindings'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      integration_id: String(doc.integrationId),
      user_id: String(doc.userId),
      agent_id: String(doc.agentId),
      telegram_chat_id: String(doc.telegramChatId),
      telegram_user_id: s(doc.telegramUserId),
      conversation_id: s(doc.conversationId),
      last_message_at: dateOf(doc.lastMessageAt),
      created_at: dateOf(doc.createdAt) ?? new Date(),
      updated_at: dateOf(doc.updatedAt) ?? new Date(),
    }),
    validate: (unit) => (!pgIntegrationIds.has(String(unit.integration_id))
      ? `dangling integration_id ${unit.integration_id} (integration not in PG)`
      : null),
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM channels.telegram_chat_bindings WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO channels.telegram_chat_bindings
           (id, integration_id, user_id, agent_id, telegram_chat_id, telegram_user_id,
            conversation_id, last_message_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.integration_id, unit.user_id, unit.agent_id, unit.telegram_chat_id,
         unit.telegram_user_id, unit.conversation_id, unit.last_message_at,
         unit.created_at, unit.updated_at],
      );
    },
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM channels.telegram_chat_bindings WHERE id = ANY($1)', [ids]);
      return new Map(r.rows.map((row) => [row.id, row]));
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM channels.telegram_chat_bindings')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM channels.telegram_chat_bindings')).rows.map((r) => r.id),
  });

  // ── channels.widget_tokens (plan 4.15: tokens only) ─────────────────
  await runBackfill({
    collection: mdb.collection('widget_tokens'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      token_hash: String(doc.tokenHash),
      agent_id: String(doc.agentId),
      label: s(doc.label),
      allowed_origins: Array.isArray(doc.allowedOrigins) ? doc.allowedOrigins.map(String) : [],
      is_active: doc.isActive !== false,
      expires_at: dateOf(doc.expiresAt),
      last_used_at: dateOf(doc.lastUsedAt),
      created_by: String(doc.createdBy),
      created_at: dateOf(doc.createdAt) ?? new Date(),
      updated_at: dateOf(doc.updatedAt) ?? new Date(),
    }),
    validate: (unit) => {
      if (!pgAgentIds.has(String(unit.agent_id))) return `dangling agent_id ${unit.agent_id} (agent gone from PG; FK would reject)`;
      // char(64) column; these are corrupt double-hex legacy tokens, reported for P10.
      if (String(unit.token_hash).length > 64) return `token_hash ${String(unit.token_hash).length} chars (> 64), corrupt legacy token`;
      return null;
    },
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM channels.widget_tokens WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO channels.widget_tokens
           (id, token_hash, agent_id, label, allowed_origins, is_active, expires_at,
            last_used_at, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.token_hash, unit.agent_id, unit.label, unit.allowed_origins,
         unit.is_active, unit.expires_at, unit.last_used_at, unit.created_by,
         unit.created_at, unit.updated_at],
      );
    },
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM channels.widget_tokens WHERE id = ANY($1)', [ids]);
      return new Map(r.rows.map((row) => [row.id, row]));
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM channels.widget_tokens')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM channels.widget_tokens')).rows.map((r) => r.id),
  });

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
