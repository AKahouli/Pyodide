/**
 * Bootstrap admin script (Postgres only — the Mongo branch was removed with
 * the identity cutover). Reads email, password and role from argv/env, hashes
 * with bcrypt(12), and upserts the user plus the role link. No hard-coded
 * hashes or ids; credentials are never printed.
 *
 * Usage:
 *   npx ts-node back/scripts/create-admin.ts --email=admin@example.com --password=... [--role=super_admin]
 *   (env: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_ROLE)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { newObjectId } from '../src/common/postgres/object-id';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? process.env[`ADMIN_${name.toUpperCase()}`];
}

async function main(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  const password = arg('password');
  const role = (arg('role') ?? 'super_admin').toLowerCase();
  if (!email || !password) {
    console.error('usage: create-admin.ts --email=... --password=... [--role=super_admin]');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
  try {
    const roleRow = await pool.query('SELECT id FROM authz.roles WHERE name = $1', [role]);
    if (roleRow.rowCount === 0) throw new Error(`role '${role}' not found — run the identity backfill / seed first`);
    const existing = await pool.query('SELECT id FROM identity.users WHERE email = $1', [email]);
    let userId: string;
    if (existing.rowCount) {
      userId = existing.rows[0].id;
      await pool.query('UPDATE identity.users SET password_hash = $2, status = $3, email_verified = true, updated_at = now() WHERE id = $1', [
        userId, passwordHash, 'active',
      ]);
    } else {
      userId = newObjectId();
      await pool.query(
        `INSERT INTO identity.users (id, email, password_hash, email_verified, status, registration_approval)
         VALUES ($1,$2,$3,true,'active','approved')`,
        [userId, email, passwordHash],
      );
    }
    await pool.query('INSERT INTO identity.user_roles (user_id, role_id, position) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [userId, roleRow.rows[0].id]);
    console.log(`admin ready in PG (user ${userId.slice(0, 6)}…, role '${role}')`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
