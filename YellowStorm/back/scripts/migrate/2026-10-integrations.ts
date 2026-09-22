/**
 * Step 3 backfill — Mongo → Postgres integrations schema.
 *   connector_categories       → integrations.connector_categories
 *   connectors                 → integrations.connectors (+ connector_skills)
 *   connector_credentials      → integrations.connector_credentials
 *   connected_app_definitions  → integrations.connected_app_definitions
 *   user_app_connections       → integrations.user_app_connections
 *   admin_connector_auth_tokens → integrations.admin_connector_auth_tokens
 * Fresh start (no backfill): connected_app_oauth_states, admin_connector_oauth_states.
 *
 * Order (remediation 2.1): categories → connectors (+skills) → credentials →
 * definitions → connections → admin tokens.
 * Every unit scans UNFILTERED and validates membership in code — Mongo mixes
 * ObjectId and string ids, so a Mongo $in filter silently matches nothing
 * (R-05); orphans instead surface as reported rejects.
 * Idempotent: ON CONFLICT DO NOTHING. --checksum covers every column
 * byte-exact, including client_secret and the token columns.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-integrations.ts [--dry-run] [--verify] [--checksum]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';
import { stableStringify } from './reconcile';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v == null ? null : String(v));
const dateOf = (v: unknown): Date | null => (v ? new Date(String(v)) : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
// canonical (key-sorted) JSON: jsonb normalizes key order, so checksums must too
const json = (v: unknown): string => stableStringify(v ?? {});

// Reports promised by the plan (2.1).
const nulledCategoryIds: string[] = [];
const droppedSkillRefs: string[] = [];
const duplicateActionKeys: string[] = [];
/** Connector → live skill refs; unit-internal, kept out of the content checksum. */
const connectorSkillRefs = new Map<string, string[]>();

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

  const pgCategoryIds = new Set(
    (await pool.query('SELECT id FROM integrations.connector_categories')).rows.map((r) => r.id),
  );

  // ── connector_categories ────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('connector_categories'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      name: String(doc.name),
      description: String(doc.description ?? ''),
      is_system: doc.isSystem === true,
      created_by: String(doc.createdBy ?? '000000000000000000000000'),
      created_at: dateOf(doc.createdAt) ?? new Date(),
      updated_at: dateOf(doc.updatedAt) ?? new Date(),
    }),
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM integrations.connector_categories WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO integrations.connector_categories (id, name, description, is_system, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.name, unit.description, unit.is_system, unit.created_by, unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query('SELECT name, is_system FROM integrations.connector_categories WHERE id = $1', [String(unit.id)]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].name !== unit.name || r.rows[0].is_system !== unit.is_system) map.set(String(unit.id), 'field mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM integrations.connector_categories')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM integrations.connector_categories')).rows.map((r) => r.id),
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM integrations.connector_categories WHERE id = ANY($1)', [ids]);
      return new Map(r.rows.map((row) => [row.id, row]));
    },
  });

  for (const row of (await pool.query('SELECT id FROM integrations.connector_categories')).rows) pgCategoryIds.add(row.id);

  // ── connectors (+ connector_skills) ─────────────────────────────────
  {
    const pgSkillIds = new Set((await pool.query('SELECT id FROM catalog.skills')).rows.map((r) => r.id));
    for (const doc of await mdb.collection('connectors').find({}, { projection: { actions: 1 } }).toArray()) {
      const keys = new Set<string>();
      for (const action of Array.isArray(doc.actions) ? doc.actions : []) {
        const key = String((action as Record<string, unknown>)?.key ?? '');
        if (!key) continue;
        if (keys.has(key)) duplicateActionKeys.push(`${String(doc._id)}:${key}`);
        keys.add(key);
      }
    }
    await runBackfill({
    collection: mdb.collection('connectors'),
    build: (doc: MongoDoc): Row => {
      const categoryId = s(doc.categoryId);
      if (categoryId && !pgCategoryIds.has(categoryId)) {
        doc.categoryId = null;
        nulledCategoryIds.push(`${String(doc._id)}:${categoryId}`);
      }
      const rawSkillRefs = arr(doc.referencedSkillIds);
      const liveSkillRefs = rawSkillRefs.filter((id) => pgSkillIds.has(id));
      for (const id of rawSkillRefs) if (!pgSkillIds.has(id)) droppedSkillRefs.push(`${String(doc._id)}:${id}`);
      connectorSkillRefs.set(String(doc._id), liveSkillRefs);
      return {
        id: String(doc._id),
        slug: String(doc.slug),
        name: String(doc.name),
        description: String(doc.description ?? ''),
        icon: String(doc.icon ?? ''),
        color: String(doc.color ?? ''),
        icon_color: String(doc.iconColor ?? 'light'),
        category_id: s(doc.categoryId),
        auth_type: String(doc.authType ?? 'none'),
        auth_config_schema: json(doc.authConfigSchema ?? {}),
        auth_source_type: String(doc.authSourceType ?? 'credential'),
        connected_app_key: String(doc.connectedAppKey ?? ''),
        runtime_auth_config: json(doc.runtimeAuthConfig ?? {}),
        mcp_transport_type: String(doc.mcpTransportType ?? 'streamable_http'),
        mcp_server_url: String(doc.mcpServerUrl ?? ''),
        mcp_server_config: json(doc.mcpServerConfig ?? {}),
        dynamic_headers: json(Array.isArray(doc.dynamicHeaders) ? doc.dynamicHeaders : []),
        actions: json(Array.isArray(doc.actions) ? doc.actions : []),
        is_active: doc.isActive !== false,
        is_system: doc.isSystem === true,
        is_hidden: doc.isHidden === true,
        created_by: String(doc.createdBy ?? '000000000000000000000000'),
        created_at: dateOf(doc.createdAt) ?? new Date(),
        updated_at: dateOf(doc.updatedAt) ?? new Date(),
      };
    },
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM integrations.connectors WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO integrations.connectors (id, slug, name, description, icon, color, icon_color, category_id,
             auth_type, auth_config_schema, auth_source_type, connected_app_key, runtime_auth_config,
             mcp_transport_type, mcp_server_url, mcp_server_config, dynamic_headers, actions,
             is_active, is_system, is_hidden, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,
             $19,$20,$21,$22,$23,$24) ON CONFLICT (id) DO NOTHING`,
          [unit.id, unit.slug, unit.name, unit.description, unit.icon, unit.color, unit.icon_color, unit.category_id,
           unit.auth_type, unit.auth_config_schema, unit.auth_source_type, unit.connected_app_key, unit.runtime_auth_config,
           unit.mcp_transport_type, unit.mcp_server_url, unit.mcp_server_config, unit.dynamic_headers, unit.actions,
           unit.is_active, unit.is_system, unit.is_hidden, unit.created_by, unit.created_at, unit.updated_at],
        );
        for (const [position, skillId] of (connectorSkillRefs.get(String(unit.id)) ?? []).entries()) {
          await client.query(
            `INSERT INTO integrations.connector_skills (connector_id, skill_id, position)
             VALUES ($1,$2,$3) ON CONFLICT (connector_id, skill_id) DO NOTHING`,
            [unit.id, skillId, position],
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
        const r = await pool.query(
          `SELECT c.name, (SELECT count(*)::int FROM integrations.connector_skills cs WHERE cs.connector_id = c.id) AS skill_count
           FROM integrations.connectors c WHERE c.id = $1`,
          [String(unit.id)],
        );
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].name !== unit.name) map.set(String(unit.id), 'name mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM integrations.connectors')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM integrations.connectors')).rows.map((r) => r.id),
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM integrations.connectors WHERE id = ANY($1)', [ids]);
      return new Map(r.rows.map((row) => [row.id, {
        ...row,
        // Unit stores jsonb as a JSON string; skill_ids is unit-internal.
        auth_config_schema: stableStringify(row.auth_config_schema ?? {}),
        runtime_auth_config: stableStringify(row.runtime_auth_config ?? {}),
        mcp_server_config: stableStringify(row.mcp_server_config ?? {}),
        dynamic_headers: stableStringify(row.dynamic_headers ?? []),
        actions: stableStringify(row.actions ?? []),
      }]));
    },
    });
  }

  // ── connector_credentials ───────────────────────────────────────────
  const pgConnectorIds = new Set(
    (await pool.query('SELECT id FROM integrations.connectors')).rows.map((r) => r.id),
  );
  await runBackfill({
    collection: mdb.collection('connector_credentials'),
    // Unfiltered scan (R-05): a Mongo `$in` on string ids against ObjectId
    // values matches nothing; the validate callback reports orphans instead.
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      connector_id: String(doc.connectorId),
      display_name: String(doc.displayName),
      auth_payload: json(doc.authPayload ?? {}),
      status: String(doc.status ?? 'active'),
      last_validated_at: dateOf(doc.lastValidatedAt),
      expires_at: dateOf(doc.expiresAt),
      user_id: String(doc.userId),
      created_at: dateOf(doc.createdAt) ?? new Date(),
      updated_at: dateOf(doc.updatedAt) ?? new Date(),
    }),
    validate: (unit) => (!pgConnectorIds.has(String(unit.connector_id))
      ? `dangling connector_id ${unit.connector_id} (connector gone from PG; FK would reject)`
      : null),
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM integrations.connector_credentials WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO integrations.connector_credentials (id, connector_id, display_name, auth_payload, status,
           last_validated_at, expires_at, user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.connector_id, unit.display_name, unit.auth_payload, unit.status,
         unit.last_validated_at, unit.expires_at, unit.user_id, unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query('SELECT display_name, status FROM integrations.connector_credentials WHERE id = $1', [String(unit.id)]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].display_name !== unit.display_name || r.rows[0].status !== unit.status) map.set(String(unit.id), 'field mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM integrations.connector_credentials')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM integrations.connector_credentials')).rows.map((r) => r.id),
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM integrations.connector_credentials WHERE id = ANY($1)', [ids]);
      return new Map(r.rows.map((row) => [row.id, {
        ...row,
        auth_payload: stableStringify(row.auth_payload ?? {}),
      }]));
    },
  });

  // ── connected_app_definitions ───────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('connected_app_definitions'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      app_key: String(doc.appKey).toLowerCase(),
      display_name: String(doc.displayName),
      description: s(doc.description),
      icon_key: s(doc.iconKey),
      authorization_url: String(doc.authorizationUrl),
      token_url: String(doc.tokenUrl),
      revoke_url: s(doc.revokeUrl),
      client_id: String(doc.clientId),
      client_secret: String(doc.clientSecret),
      tenant_id: s(doc.tenantId),
      scopes: arr(doc.scopes),
      pkce_enabled: doc.pkceEnabled !== false,
      enabled: doc.enabled !== false,
      sort_order: typeof doc.sortOrder === 'number' ? doc.sortOrder : 0,
      created_at: dateOf(doc.createdAt) ?? new Date(),
      updated_at: dateOf(doc.updatedAt) ?? new Date(),
    }),
    unitId: (unit) => String(unit.app_key),
    exists: async (key) => (await pool.query('SELECT 1 FROM integrations.connected_app_definitions WHERE app_key = $1', [String(key)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO integrations.connected_app_definitions
           (id, app_key, display_name, description, icon_key, authorization_url, token_url, revoke_url,
            client_id, client_secret, tenant_id, scopes, pkce_enabled, enabled, sort_order, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (app_key) DO NOTHING`,
        [unit.id, unit.app_key, unit.display_name, unit.description, unit.icon_key, unit.authorization_url,
         unit.token_url, unit.revoke_url, unit.client_id, unit.client_secret, unit.tenant_id, unit.scopes,
         unit.pkce_enabled, unit.enabled, unit.sort_order, unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query('SELECT display_name, enabled FROM integrations.connected_app_definitions WHERE app_key = $1', [String(unit.app_key)]);
        if (r.rowCount === 0) map.set(String(unit.app_key), 'missing in PG');
        else if (r.rows[0].display_name !== unit.display_name || r.rows[0].enabled !== unit.enabled) map.set(String(unit.app_key), 'field mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM integrations.connected_app_definitions')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT app_key AS id FROM integrations.connected_app_definitions')).rows.map((r) => r.id),
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM integrations.connected_app_definitions WHERE app_key = ANY($1)', [ids]);
      return new Map(r.rows.map((row) => [row.app_key, row]));
    },
  });

  // ── user_app_connections ────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('user_app_connections'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      user_id: String(doc.userId),
      app_key: String(doc.appKey),
      access_token: String(doc.accessToken),
      refresh_token: s(doc.refreshToken),
      token_expires_at: dateOf(doc.tokenExpiresAt),
      scopes: arr(doc.scopes),
      provider_account_id: s(doc.providerAccountId),
      provider_email: s(doc.providerEmail),
      status: String(doc.status ?? 'active'),
      last_used_at: dateOf(doc.lastUsedAt),
      last_refreshed_at: dateOf(doc.lastRefreshedAt),
      error_message: s(doc.errorMessage),
      created_at: dateOf(doc.createdAt) ?? new Date(),
      updated_at: dateOf(doc.updatedAt) ?? new Date(),
    }),
    unitId: (unit) => `${unit.user_id}:${unit.app_key}`,
    exists: async (key) => {
      const [userId, appKey] = String(key).split(':');
      return (await pool.query('SELECT 1 FROM integrations.user_app_connections WHERE user_id = $1 AND app_key = $2', [userId, appKey])).rowCount! > 0;
    },
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO integrations.user_app_connections (id, user_id, app_key, access_token, refresh_token,
           token_expires_at, scopes, provider_account_id, provider_email, status, last_used_at,
           last_refreshed_at, error_message, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (user_id, app_key) DO NOTHING`,
        [unit.id, unit.user_id, unit.app_key, unit.access_token, unit.refresh_token, unit.token_expires_at,
         unit.scopes, unit.provider_account_id, unit.provider_email, unit.status, unit.last_used_at,
         unit.last_refreshed_at, unit.error_message, unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const [userId, appKey] = String(unit.id).split(':');
        const r = await pool.query('SELECT status FROM integrations.user_app_connections WHERE user_id = $1 AND app_key = $2', [userId, appKey]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].status !== unit.status) map.set(String(unit.id), 'status mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM integrations.user_app_connections')).rows[0].n,
    pgIds: async () => (await pool.query("SELECT user_id || ':' || app_key AS id FROM integrations.user_app_connections")).rows.map((r) => r.id),
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM integrations.user_app_connections WHERE user_id || \':\' || app_key = ANY($1)', [ids]);
      return new Map(r.rows.map((row) => [`${row.user_id}:${row.app_key}`, row]));
    },
  });

  // ── admin_connector_auth_tokens ─────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('admin_connector_auth_tokens'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      user_id: String(doc.userId),
      app_key: String(doc.appKey),
      access_token: s(doc.accessToken),
      refresh_token: s(doc.refreshToken),
      token_expires_at: dateOf(doc.tokenExpiresAt),
      scopes: arr(doc.scopes),
      provider_account_id: s(doc.providerAccountId),
      provider_email: s(doc.providerEmail),
      connected: doc.connected !== false,
      status: String(doc.status ?? 'active'),
      disconnected_at: dateOf(doc.disconnectedAt),
      last_used_at: dateOf(doc.lastUsedAt),
      last_refreshed_at: dateOf(doc.lastRefreshedAt),
      error_message: s(doc.errorMessage),
      created_at: dateOf(doc.createdAt) ?? new Date(),
      updated_at: dateOf(doc.updatedAt) ?? new Date(),
    }),
    unitId: (unit) => `${unit.user_id}:${unit.app_key}`,
    exists: async (key) => {
      const [userId, appKey] = String(key).split(':');
      return (await pool.query('SELECT 1 FROM integrations.admin_connector_auth_tokens WHERE user_id = $1 AND app_key = $2', [userId, appKey])).rowCount! > 0;
    },
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO integrations.admin_connector_auth_tokens (id, user_id, app_key, access_token, refresh_token,
           token_expires_at, scopes, provider_account_id, provider_email, connected, status, disconnected_at,
           last_used_at, last_refreshed_at, error_message, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (user_id, app_key) DO NOTHING`,
        [unit.id, unit.user_id, unit.app_key, unit.access_token, unit.refresh_token, unit.token_expires_at,
         unit.scopes, unit.provider_account_id, unit.provider_email, unit.connected, unit.status,
         unit.disconnected_at, unit.last_used_at, unit.last_refreshed_at, unit.error_message,
         unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const [userId, appKey] = String(unit.id).split(':');
        const r = await pool.query('SELECT connected FROM integrations.admin_connector_auth_tokens WHERE user_id = $1 AND app_key = $2', [userId, appKey]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].connected !== unit.connected) map.set(String(unit.id), 'connected mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM integrations.admin_connector_auth_tokens')).rows[0].n,
    pgIds: async () => (await pool.query("SELECT user_id || ':' || app_key AS id FROM integrations.admin_connector_auth_tokens")).rows.map((r) => r.id),
    checksumRows: async (ids) => {
      const r = await pool.query('SELECT * FROM integrations.admin_connector_auth_tokens WHERE user_id || \':\' || app_key = ANY($1)', [ids]);
      return new Map(r.rows.map((row) => [`${row.user_id}:${row.app_key}`, row]));
    },
  });

  console.log('=== reports (2.1) ===');
  console.log(JSON.stringify({
    nulledCategoryIds,
    droppedSkillRefs,
    duplicateActionKeys,
  }, null, 2));

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
