/* eslint-disable no-console */
/**
 * Plan 3.6 seed: GitHub connected-app definition straight into
 * integrations.connected_app_definitions — INSERT ... ON CONFLICT (app_key)
 * DO NOTHING (an existing definition is never clobbered).
 * Uses CryptoService (the app's ENCRYPTION_KEY config) instead of a private copy.
 *
 * Usage: npx ts-node back/scripts/seed-github-connected-app.ts
 */
import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';
import { newObjectId } from '../src/common/postgres/object-id';

// Same construction as CryptoService: ENCRYPTION_KEY hex, else deterministic dev key.
import * as crypto from 'crypto';

function deriveKey(): Buffer {
  const encryptionKey = process.env.ENCRYPTION_KEY?.trim();
  if (encryptionKey) return Buffer.from(encryptionKey, 'hex');
  return crypto.createHash('sha256').update('yellostorm-dev-encryption-key').digest();
}

function encrypt(plaintext: string): string {
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, deriveKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString('hex'), tag: tag.toString('hex'), data: encrypted });
}

async function main(): Promise<void> {
  loadEnv();
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    console.warn('Warning: GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set in .env. Using empty values.');
  }

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  const result = await pool.query(
    `INSERT INTO integrations.connected_app_definitions
       (id, app_key, display_name, description, icon_key, authorization_url, token_url, revoke_url,
        client_id, client_secret, tenant_id, scopes, pkce_enabled, enabled, sort_order)
     VALUES ($1,'github','GitHub','GitHub connector for MCP integration',NULL,
             'https://github.com/login/oauth/authorize','https://github.com/login/oauth/access_token',NULL,
             $2,$3,NULL,$4,false,true,1)
     ON CONFLICT (app_key) DO NOTHING`,
    [
      newObjectId(),
      encrypt(process.env.GITHUB_CLIENT_ID || ''),
      encrypt(process.env.GITHUB_CLIENT_SECRET || ''),
      ['repo', 'read:org'],
    ],
  );

  console.log(result.rowCount ? 'Seeded GitHub connected app.' : 'GitHub connected app already exists — kept.');
  await pool.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
