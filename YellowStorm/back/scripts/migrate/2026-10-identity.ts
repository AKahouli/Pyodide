/**
 * Step 1A.16 backfill — Mongo identity collections → Postgres identity/authz.
 *
 * Order: roles → users (+user_roles) → user_groups (+members) →
 * auth_providers → user_provider_links → audit_logs. Sessions, oauth_states
 * and provider_link_tokens are NOT copied (fresh at cutover — one forced
 * re-login).
 *
 * Data policy (plan 1A.16):
 * - ids are preserved (baked into JWTs/Ceph/ADK payloads);
 * - emails are trimmed + lowercased; a duplicate after lowercasing is a
 *   reject (resolve manually before --strict);
 * - passwordHash / emailVerificationToken / passwordResetToken and all
 *   auth_provider ciphertexts are copied byte-for-byte (--checksum);
 * - unknown role ids in users.roles are dropped and reported;
 * - user_groups: dangling members dropped + reported, duplicates deduped;
 * - audit_logs older than 730 days are skipped (the TTL would have removed).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-identity.ts [--dry-run] [--checksum] [--verify] [--only=<unit>]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, BackfillError, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const AUDIT_RETENTION_DAYS = 730;
const isObjectId = (v: unknown): boolean => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);

type Row = Record<string, unknown>;

const s = (v: unknown): string | null => (v == null ? null : String(v));
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const b = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const n = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

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

  // ---- reference data ----------------------------------------------------
  const roleDocs = await col('roles').find({}).toArray();
  const validRoleIds = new Set(roleDocs.map((r) => String(r._id)));
  const userIds = new Set<string>();

  await run('roles', async () => {
    await runBackfill({
      collection: col('roles'),
      build: (doc: MongoDoc): Row => ({
        id: String(doc._id),
        name: String(doc.name).toLowerCase(),
        description: String(doc.description ?? ''),
        permissions: Array.isArray(doc.permissions) ? doc.permissions : [],
        is_active: b(doc.isActive, true),
        is_system: b(doc.isSystem),
        priority: n(doc.priority, 0),
        created_at: d(doc.createdAt) ?? new Date(),
        updated_at: d(doc.updatedAt) ?? new Date(),
      }),
      validate: (unit) => (!String(unit.name) ? 'missing name' : null),
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM authz.roles WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await insertRow(
          pool,
          `INSERT INTO authz.roles (id, name, description, permissions, is_active, is_system, priority, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
          [unit.id, unit.name, unit.description, unit.permissions, unit.is_active, unit.is_system, unit.priority, unit.created_at, unit.updated_at],
        );
      },
      verify: async (units) => {
        const map = new Map<string, string>();
        for (const unit of units) {
          const r = await pool.query('SELECT name, priority FROM authz.roles WHERE id = $1', [String(unit.id)]);
          if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
          else if (r.rows[0].name !== unit.name) map.set(String(unit.id), 'name mismatch');
        }
        return map;
      },
      pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM authz.roles')).rows[0].n,
      pgIds: async () => (await pool.query('SELECT id FROM authz.roles')).rows.map((r) => r.id),
    });
  });

  await run('users', async () => {
    const seenEmails = new Set<string>();
    await runBackfill({
      collection: col('users'),
      build: (doc: MongoDoc): Row => {
        const id = String(doc._id);
        const email = String(doc.email ?? '').trim().toLowerCase();
        if (!isObjectId(id) || !email) throw new BackfillError('missing id or email', id);
        if (seenEmails.has(email)) throw new BackfillError(`duplicate lower(email)=${email}`, id);
        seenEmails.add(email);
        const profile = (doc.profile ?? {}) as Record<string, unknown>;
        const appearance = (doc.appearance ?? {}) as Record<string, unknown>;
        const consents = (doc.consents ?? {}) as Record<string, unknown>;
        return {
          id,
          email,
          password_hash: String(doc.passwordHash),
          email_verified: b(doc.emailVerified),
          email_verification_token: s(doc.emailVerificationToken),
          email_verification_expiry: d(doc.emailVerificationExpiry),
          password_reset_token: s(doc.passwordResetToken),
          password_reset_expiry: d(doc.passwordResetExpiry),
          first_name: s(profile.firstName),
          last_name: s(profile.lastName),
          company: s(profile.company),
          profile_role: String(profile.role ?? ''),
          description: String(profile.description ?? ''),
          color_theme: String(appearance.colorTheme ?? 'default'),
          language: String(appearance.language ?? 'en'),
          consent_privacy_policy: b(consents.privacyPolicy),
          consent_privacy_policy_accepted_at: d(consents.privacyPolicyAcceptedAt),
          consent_data_sharing: b(consents.dataSharing),
          consent_data_sharing_accepted_at: d(consents.dataSharingAcceptedAt),
          profile_complete: b(doc.profileComplete),
          microsoft_account_id: s(doc.microsoftAccountId),
          plan_id: s(doc.planId),
          plan_slug: s(doc.planSlug),
          plan_started_at: d(doc.planStartedAt),
          permissions_version: n(doc.permissionsVersion, 1),
          status: String(doc.status ?? 'active'),
          registration_approval: s(doc.registrationApproval),
          last_login_at: d(doc.lastLoginAt),
          created_at: d(doc.createdAt) ?? new Date(),
          updated_at: d(doc.updatedAt) ?? new Date(),
          roles: Array.isArray(doc.roles) ? doc.roles.map(String).filter((r) => validRoleIds.has(r)) : [],
          dropped_roles: Array.isArray(doc.roles)
            ? doc.roles.map(String).filter((r) => !validRoleIds.has(r) && isObjectId(r))
            : [],
        };
      },
      validate: (unit) =>
        !['active', 'inactive', 'suspended'].includes(String(unit.status)) ? `invalid status ${unit.status}` : null,
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM identity.users WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO identity.users (id, email, password_hash, email_verified, email_verification_token,
              email_verification_expiry, password_reset_token, password_reset_expiry, first_name, last_name,
              company, profile_role, description, color_theme, language, consent_privacy_policy,
              consent_privacy_policy_accepted_at, consent_data_sharing, consent_data_sharing_accepted_at,
              profile_complete, microsoft_account_id, plan_id, plan_slug, plan_started_at, permissions_version,
              status, registration_approval, last_login_at, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
             ON CONFLICT (id) DO NOTHING`,
            [
              unit.id, unit.email, unit.password_hash, unit.email_verified, unit.email_verification_token,
              unit.email_verification_expiry, unit.password_reset_token, unit.password_reset_expiry,
              unit.first_name, unit.last_name, unit.company, unit.profile_role, unit.description,
              unit.color_theme, unit.language, unit.consent_privacy_policy, unit.consent_privacy_policy_accepted_at,
              unit.consent_data_sharing, unit.consent_data_sharing_accepted_at, unit.profile_complete,
              unit.microsoft_account_id, unit.plan_id, unit.plan_slug, unit.plan_started_at,
              unit.permissions_version, unit.status, unit.registration_approval, unit.last_login_at,
              unit.created_at, unit.updated_at,
            ],
          );
          for (let position = 0; position < (unit.roles as string[]).length; position += 1) {
            await client.query(
              'INSERT INTO identity.user_roles (user_id, role_id, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
              [unit.id, (unit.roles as string[])[position], position],
            );
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      refs: [
        {
          label: 'users.roles → roles (dropped unknown ids are reported in failures)',
          path: 'roles',
          exists: async (ids) => new Set(ids.filter((id) => validRoleIds.has(id))),
        },
      ],
      verify: async (units) => {
        const map = new Map<string, string>();
        for (const unit of units) {
          const r = await pool.query(
            'SELECT email, role_id FROM identity.users u LEFT JOIN identity.user_roles ur ON ur.user_id = u.id WHERE u.id = $1 ORDER BY ur.position',
            [String(unit.id)],
          );
          if (r.rowCount === 0) { map.set(String(unit.id), 'missing in PG'); continue; }
          if (r.rows[0].email !== unit.email) map.set(String(unit.id), 'email mismatch');
          const pgRoles = r.rows.map((row) => row.role_id).filter(Boolean);
          const expected = unit.roles as string[];
          if (JSON.stringify(pgRoles) !== JSON.stringify(expected)) map.set(String(unit.id), 'roles mismatch');
        }
        return map;
      },
      pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM identity.users')).rows[0].n,
      pgIds: async () => (await pool.query('SELECT id FROM identity.users')).rows.map((r) => r.id),
    });
    const all = await col('users').find({}, { projection: { _id: 1 } }).toArray();
    for (const doc of all) userIds.add(String(doc._id));
  });

  await run('user_groups', async () => {
    await runBackfill({
      collection: col('user_groups'),
      build: (doc: MongoDoc): Row => {
        const members: string[] = [];
        const dangling: string[] = [];
        const seen = new Set<string>();
        for (const m of (Array.isArray(doc.members) ? doc.members : []).map(String)) {
          if (!userIds.has(m)) { dangling.push(m); continue; }
          if (!seen.has(m)) { seen.add(m); members.push(m); }
        }
        return {
          id: String(doc._id),
          name: String(doc.name),
          description: String(doc.description ?? ''),
          created_by: String(doc.createdBy),
          created_at: d(doc.createdAt) ?? new Date(),
          updated_at: d(doc.updatedAt) ?? new Date(),
          members,
          dangling_members: dangling,
        };
      },
      validate: (unit) => (String(unit.name).length < 2 ? 'invalid name' : null),
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM identity.user_groups WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO identity.user_groups (id, name, description, created_by, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
            [unit.id, unit.name, unit.description, unit.created_by, unit.created_at, unit.updated_at],
          );
          for (let position = 0; position < (unit.members as string[]).length; position += 1) {
            await client.query(
              'INSERT INTO identity.user_group_members (group_id, user_id, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
              [unit.id, (unit.members as string[])[position], position],
            );
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM identity.user_groups')).rows[0].n,
      pgIds: async () => (await pool.query('SELECT id FROM identity.user_groups')).rows.map((r) => r.id),
    });
  });

  await run('auth_providers', async () => {
    await runBackfill({
      collection: col('auth_providers'),
      build: (doc: MongoDoc): Row => ({
        id: String(doc._id),
        provider_key: String(doc.providerKey).toLowerCase(),
        display_name: String(doc.displayName),
        // Ciphertext copied byte-for-byte; never decrypted or trimmed.
        client_id: String(doc.clientId),
        client_secret: String(doc.clientSecret),
        tenant_id: s(doc.tenantId),
        authorization_url: String(doc.authorizationUrl),
        token_url: String(doc.tokenUrl),
        userinfo_url: String(doc.userinfoUrl),
        scopes: Array.isArray(doc.scopes) ? doc.scopes : ['openid', 'email', 'profile'],
        icon_key: s(doc.iconKey),
        sort_order: n(doc.sortOrder, 0),
        pkce_enabled: b(doc.pkceEnabled, true),
        enabled: b(doc.enabled, true),
        created_at: d(doc.createdAt) ?? new Date(),
        updated_at: d(doc.updatedAt) ?? new Date(),
      }),
      validate: (unit) => (!String(unit.provider_key) || !String(unit.client_id) || !String(unit.client_secret) ? 'missing required provider fields' : null),
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM identity.auth_providers WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await insertRow(
          pool,
          `INSERT INTO identity.auth_providers (id, provider_key, display_name, client_id, client_secret, tenant_id,
            authorization_url, token_url, userinfo_url, scopes, icon_key, sort_order, pkce_enabled, enabled, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
          [
            unit.id, unit.provider_key, unit.display_name, unit.client_id, unit.client_secret, unit.tenant_id,
            unit.authorization_url, unit.token_url, unit.userinfo_url, unit.scopes, unit.icon_key,
            unit.sort_order, unit.pkce_enabled, unit.enabled, unit.created_at, unit.updated_at,
          ],
        );
      },
      checksumRows: async (ids) => {
        const r = await pool.query('SELECT id, client_id, client_secret, tenant_id FROM identity.auth_providers WHERE id = ANY($1)', [ids]);
        return new Map(r.rows.map((row) => [row.id, { clientId: row.client_id, clientSecret: row.client_secret, tenantId: row.tenant_id }]));
      },
      pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM identity.auth_providers')).rows[0].n,
      pgIds: async () => (await pool.query('SELECT id FROM identity.auth_providers')).rows.map((r) => r.id),
    });
  });

  await run('user_provider_links', async () => {
    await runBackfill({
      collection: col('user_provider_links'),
      build: (doc: MongoDoc): Row => ({
        id: String(doc._id),
        user_id: String(doc.userId),
        provider_key: String(doc.providerKey),
        provider_user_id: String(doc.providerUserId),
        provider_email: String(doc.providerEmail ?? '').toLowerCase(),
        linked_at: d(doc.linkedAt) ?? d(doc.createdAt) ?? new Date(),
        created_at: d(doc.createdAt) ?? new Date(),
        updated_at: d(doc.updatedAt) ?? new Date(),
      }),
      validate: (unit) => (!userIds.has(String(unit.user_id)) ? `dangling userId ${unit.user_id}` : null),
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM identity.user_provider_links WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await insertRow(
          pool,
          `INSERT INTO identity.user_provider_links (id, user_id, provider_key, provider_user_id, provider_email, linked_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [unit.id, unit.user_id, unit.provider_key, unit.provider_user_id, unit.provider_email, unit.linked_at, unit.created_at, unit.updated_at],
        );
      },
      pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM identity.user_provider_links')).rows[0].n,
      pgIds: async () => (await pool.query('SELECT id FROM identity.user_provider_links')).rows.map((r) => r.id),
    });
  });

  await run('audit_logs', async () => {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000);
    await runBackfill({
      collection: col('audit_logs'),
      filter: { createdAt: { $gte: cutoff } },
      build: (doc: MongoDoc): Row => ({
        id: String(doc._id),
        actor_id: String(doc.actorId),
        actor_email: String(doc.actorEmail ?? ''),
        action: String(doc.action),
        target_id: s(doc.targetId),
        target_type: s(doc.targetType),
        metadata: (doc.metadata as Record<string, unknown>) ?? null,
        ip_address: s(doc.ipAddress),
        user_agent: s(doc.userAgent),
        status: String(doc.status),
        failure_reason: s(doc.failureReason),
        created_at: d(doc.createdAt) ?? new Date(),
      }),
      validate: (unit) => (!['success', 'failure'].includes(String(unit.status)) ? `invalid status ${unit.status}` : null),
      unitId: (unit) => unit.id as string,
      exists: async (id) => {
        const r = await pool.query('SELECT 1 FROM authz.audit_logs WHERE id = $1', [id]);
        return r.rowCount! > 0;
      },
      insert: async (unit) => {
        await insertRow(
          pool,
          `INSERT INTO authz.audit_logs (id, actor_id, actor_email, action, target_id, target_type, metadata,
            ip_address, user_agent, status, failure_reason, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [
            unit.id, unit.actor_id, unit.actor_email, unit.action, unit.target_id, unit.target_type,
            unit.metadata ? JSON.stringify(unit.metadata) : null, unit.ip_address, unit.user_agent,
            unit.status, unit.failure_reason, unit.created_at,
          ],
        );
      },
      progressEvery: 5000,
      pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM authz.audit_logs')).rows[0].n,
      pgIds: async () => (await pool.query('SELECT id FROM authz.audit_logs')).rows.map((r) => r.id),
    });
  });

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
