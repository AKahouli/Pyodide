/**
 * Step A.12: attach the cross-schema FK conversation.conversations.project_id →
 * project.projects as NOT VALID, report orphaned references, and VALIDATE only
 * when none remain. Idempotent.
 *
 * Part of the module-binding rollback procedure: run with --drop to remove the
 * constraint (projects created in PG after the flip cannot exist in Mongo, so
 * new conversations would violate the FK).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-project-fk.ts [--drop]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

async function main(): Promise<void> {
  const drop = process.argv.includes('--drop');
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 1,
  });

  if (drop) {
    await pool.query(`ALTER TABLE conversation.conversations DROP CONSTRAINT IF EXISTS fk_conversations_project`);
    console.log('constraint fk_conversations_project dropped');
    await pool.end();
    return;
  }

  const existing = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversations_project'`,
  );
  if (existing.rowCount === 0) {
    await pool.query(
      `ALTER TABLE conversation.conversations
         ADD CONSTRAINT fk_conversations_project
         FOREIGN KEY (project_id) REFERENCES project.projects(id) NOT VALID`,
    );
    console.log('constraint fk_conversations_project added (NOT VALID)');
  } else {
    console.log('constraint fk_conversations_project already exists');
  }

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM conversation.conversations c
       WHERE c.project_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM project.projects p WHERE p.id = c.project_id)`,
  );
  console.log(`conversations referencing missing projects: ${rows[0].n}`);

  if (rows[0].n === 0) {
    await pool.query(`ALTER TABLE conversation.conversations VALIDATE CONSTRAINT fk_conversations_project`);
    console.log('constraint validated');
  } else {
    console.log('constraint left NOT VALID — resolve orphaned references first');
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
