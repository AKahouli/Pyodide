/**
 * Repairs group conversations whose creator is missing from the membership table.
 *
 * Private sharing used to promote a 1:1 conversation to a group by adding only
 * the recipients, leaving the creator without an owner membership row. The owner
 * then saw the "Enter Conversation" invite landing and a 404 on join, and the
 * conversation could not be recognised as shared.
 *
 * Idempotent and safe to run against live traffic: candidate conversation rows
 * are locked FOR UPDATE (the same lock runtime member insertion takes), and the
 * insert uses ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   cd back && npx ts-node scripts/migrations/2026-09-18-repair-conversation-owner-members.ts [--dry-run]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const MISSING_OWNER = `
  FROM conversation.conversations c
  WHERE c.is_group = true
    AND NOT EXISTS (
      SELECT 1 FROM conversation.conversation_group_members gm
      WHERE gm.conversation_id = c.id AND gm.user_id = c.created_by
    )
`;

const LOCK_CANDIDATES = `SELECT c.id ${MISSING_OWNER} FOR UPDATE`;

const INSERT_OWNERS = `
  INSERT INTO conversation.conversation_group_members
    (conversation_id, user_id, position, joined_at, status)
  SELECT
    c.id,
    c.created_by,
    COALESCE(
      (SELECT max(gm.position) + 1 FROM conversation.conversation_group_members gm WHERE gm.conversation_id = c.id),
      0
    ),
    now(),
    'owner'
  ${MISSING_OWNER}
  ON CONFLICT (conversation_id, user_id) DO NOTHING
`;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 1,
  });
  try {
    if (dryRun) {
      const before = await pool.query<{ missing: number }>(`SELECT count(*)::int AS missing ${MISSING_OWNER}`);
      console.log(`Conversations missing an owner member row: ${String(before.rows[0]?.missing ?? 0)}`);
      console.log('Dry run: no rows inserted.');
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(LOCK_CANDIDATES);
      const result = await client.query(INSERT_OWNERS);
      await client.query('COMMIT');
      console.log(`Inserted ${String(result.rowCount ?? 0)} owner membership row(s).`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
