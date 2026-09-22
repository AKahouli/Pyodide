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
  let pgAgentIds = new Set((await pool.query('SELECT id FROM public.agents')).rows.map((r) => r.id));

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

  // ── remediation 2.5: shares / teams / auto-builder ──────────────────
  // Four units never backfilled by the original cutover (R-03). Every unit
  // scans UNFILTERED and validates membership in code (Mongo mixes ObjectId
  // and string ids). Membership sets are re-read live so re-runs see what
  // earlier units in the same pass inserted.
  const pgUserIds = new Set((await pool.query('SELECT id FROM identity.users')).rows.map((r) => r.id));
  pgAgentIds = new Set((await pool.query('SELECT id FROM public.agents')).rows.map((r) => r.id));

  // ── public.shared_agents ────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('shared_agents'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      agent_id: String(doc.agentId),
      shared_by: String(doc.sharedBy),
      shared_with: String(doc.sharedWith),
      permission: String(doc.permission ?? 'read'),
      created_at: dateOf(doc.createdAt) ?? new Date(),
      updated_at: dateOf(doc.updatedAt) ?? new Date(),
    }),
    validate: (unit) => {
      if (!pgAgentIds.has(String(unit.agent_id))) return `dangling agent_id ${unit.agent_id} (agent gone from PG; FK would reject)`;
      if (!pgUserIds.has(String(unit.shared_by))) return `dangling shared_by ${unit.shared_by} (user gone from PG; FK would reject)`;
      if (!pgUserIds.has(String(unit.shared_with))) return `dangling shared_with ${unit.shared_with} (user gone from PG; FK would reject)`;
      if (!['read', 'write'].includes(String(unit.permission))) return `invalid permission ${unit.permission}`;
      return null;
    },
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM public.shared_agents WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO public.shared_agents (id, agent_id, shared_by, shared_with, permission, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.agent_id, unit.shared_by, unit.shared_with, unit.permission, unit.created_at, unit.updated_at],
      );
    },
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM public.shared_agents WHERE id = ANY($1)', [ids]);
      return new Map(r.rows.map((row) => [row.id, row]));
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM public.shared_agents')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM public.shared_agents')).rows.map((r) => r.id),
  });

  // ── teams.teams (+ teams.team_members) ──────────────────────────────
  const droppedMembers: string[] = [];
  const demotedParents: string[] = [];
  await runBackfill({
    collection: mdb.collection('teams'),
    build: (doc: MongoDoc): Row => {
      // Members de-duplicated by agentId (first wins); dangling agents dropped
      // and reported; position = array index; order clamped >= 0.
      const seen = new Set<string>();
      const members: Array<Row> = [];
      for (const m of (Array.isArray(doc.members) ? doc.members : [])) {
        const agentId = String(m?.agentId ?? '');
        if (!agentId || seen.has(agentId)) continue;
        seen.add(agentId);
        if (!pgAgentIds.has(agentId)) {
          droppedMembers.push(`${String(doc._id)}:${agentId}`);
          continue;
        }
        const parentAgentId = m?.parentAgentId ? String(m.parentAgentId) : null;
        if (parentAgentId && !pgAgentIds.has(parentAgentId)) {
          demotedParents.push(`${String(doc._id)}:${parentAgentId}`);
        }
        members.push({
          agent_id: agentId,
          parent_agent_id: parentAgentId && pgAgentIds.has(parentAgentId) ? parentAgentId : null,
          order: typeof m?.order === 'number' && m.order >= 0 ? m.order : 0,
          position_x: typeof m?.positionX === 'number' ? m.positionX : 0,
          position_y: typeof m?.positionY === 'number' ? m.positionY : 0,
        });
      }
      return {
        id: String(doc._id),
        name: String(doc.name ?? '').trim(),
        description: String(doc.description ?? ''),
        is_active: doc.isActive !== false,
        created_by: String(doc.createdBy),
        created_at: dateOf(doc.createdAt) ?? new Date(),
        updated_at: dateOf(doc.updatedAt) ?? new Date(),
        members,
      };
    },
    validate: (unit) => {
      if (String(unit.name).length < 2) return `invalid name '${unit.name}'`;
      if (!pgUserIds.has(String(unit.created_by))) return `dangling created_by ${unit.created_by} (user gone from PG; FK would reject)`;
      return null;
    },
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM teams.teams WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO teams.teams (id, name, description, is_active, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [unit.id, unit.name, unit.description, unit.is_active, unit.created_by, unit.created_at, unit.updated_at],
        );
        const members = unit.members as Array<Record<string, unknown>>;
        for (let position = 0; position < members.length; position += 1) {
          const m = members[position];
          await client.query(
            `INSERT INTO teams.team_members (team_id, agent_id, parent_agent_id, "order", position_x, position_y, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (team_id, agent_id) DO NOTHING`,
            [unit.id, m.agent_id, m.parent_agent_id, m.order, m.position_x, m.position_y, position],
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query('SELECT name FROM teams.teams WHERE id = $1', [String(unit.id)]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].name !== unit.name) map.set(String(unit.id), 'name mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM teams.teams')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM teams.teams')).rows.map((r) => r.id),
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM teams.teams WHERE id = ANY($1)', [ids]);
      // members is unit-internal (junction rows), excluded from the hash.
      return new Map(r.rows.map((row) => [row.id, { ...row, members: undefined }]));
    },
  });

  // ── teams.shared_teams ──────────────────────────────────────────────
  const pgTeamIds = new Set((await pool.query('SELECT id FROM teams.teams')).rows.map((r) => r.id));
  await runBackfill({
    collection: mdb.collection('shared_teams'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      team_id: String(doc.teamId),
      shared_by: String(doc.sharedBy),
      shared_with: String(doc.sharedWith),
      permission: String(doc.permission ?? 'read'),
      created_at: dateOf(doc.createdAt) ?? new Date(),
      updated_at: dateOf(doc.updatedAt) ?? new Date(),
    }),
    validate: (unit) => {
      // Teams must exist first: this unit runs after the teams unit.
      if (!pgTeamIds.has(String(unit.team_id))) return `dangling team_id ${unit.team_id} (team rejected or gone from PG; FK would reject)`;
      if (!pgUserIds.has(String(unit.shared_by))) return `dangling shared_by ${unit.shared_by} (user gone from PG; FK would reject)`;
      if (!pgUserIds.has(String(unit.shared_with))) return `dangling shared_with ${unit.shared_with} (user gone from PG; FK would reject)`;
      if (!['read', 'write'].includes(String(unit.permission))) return `invalid permission ${unit.permission}`;
      return null;
    },
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM teams.shared_teams WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO teams.shared_teams (id, team_id, shared_by, shared_with, permission, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.team_id, unit.shared_by, unit.shared_with, unit.permission, unit.created_at, unit.updated_at],
      );
    },
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM teams.shared_teams WHERE id = ANY($1)', [ids]);
      return new Map(r.rows.map((row) => [row.id, row]));
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM teams.shared_teams')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM teams.shared_teams')).rows.map((r) => r.id),
  });

  // ── teams.auto_builder_config (singleton; newest wins) ──────────────
  {
    const docs = await mdb.collection('team_auto_builder_config').find({}).sort({ updatedAt: -1 }).toArray();
    if (docs.length > 1) {
      console.log(`[auto_builder_config] ${docs.length} docs found; taking the newest by updatedAt`);
    }
    const newest = docs[0];
    if (newest) {
      await runBackfill({
        collection: mdb.collection('team_auto_builder_config'),
        filter: { _id: newest._id },
        build: (doc: MongoDoc): Row => ({
          id: String(doc._id),
          singleton: true,
          model_id: String(doc.modelId),
          system_prompt: String(doc.systemPrompt),
          temperature: typeof doc.temperature === 'number' ? doc.temperature : 0.7,
          is_enabled: doc.isEnabled === true,
          created_at: dateOf(doc.createdAt) ?? new Date(),
          updated_at: dateOf(doc.updatedAt) ?? new Date(),
        }),
        unitId: () => 'singleton',
        exists: async () => (await pool.query('SELECT 1 FROM teams.auto_builder_config LIMIT 1')).rowCount! > 0,
        insert: async (unit) => {
          await pool.query(
            `INSERT INTO teams.auto_builder_config (id, singleton, model_id, system_prompt, temperature, is_enabled, created_at, updated_at)
             VALUES ($1,true,$2,$3,$4,$5,$6,$7) ON CONFLICT (singleton) DO NOTHING`,
            [unit.id, unit.model_id, unit.system_prompt, unit.temperature, unit.is_enabled, unit.created_at, unit.updated_at],
          );
        },
        pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM teams.auto_builder_config')).rows[0].n,
      });
    }
  }

  console.log('=== reports (2.5) ===');
  console.log(JSON.stringify({
    droppedMembers,
    demotedParents,
  }, null, 2));

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
