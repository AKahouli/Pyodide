/**
 * Records out-of-band applied migrations in drizzle.__drizzle_migrations
 * (remediation 5.2b / R-23). A journal entry whose `when` is below the DB
 * watermark would be silently skipped by migrate(); recording 0023/0024 keeps
 * the bookkeeping consistent.
 *
 * For each journal entry missing from the table: first verifies the
 * migration's objects actually exist (to_regclass probes), then inserts the
 * row exactly as drizzle would (sha256 of the SQL file, created_at = journal
 * when). Rows with an older created_at do NOT move drizzle's watermark (it
 * reads only the newest row), so this is watermark-safe.
 *
 * --dry-run by default; --apply needs explicit approval.
 *
 * Usage: npx ts-node back/scripts/migrate/record-applied-migrations.ts [--apply]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

/** Journal tag → objects that must exist before the entry may be recorded. */
const OBJECT_PROBES: Record<string, string[]> = {
  '0023_integrations': ['integrations.connectors', 'integrations.connected_app_definitions', 'integrations.connector_credentials'],
  '0024_agent_ecosystem': ['channels.telegram_integrations', 'channels.widget_tokens', 'teams.teams', 'public.shared_agents'],
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const journalPath = path.resolve(__dirname, '..', '..', 'drizzle', 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ idx: number; when: number; tag: string }>;
  };

  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
  await client.connect();

  const { rows: existing } = await client.query<{ created_at: string }>(
    'SELECT created_at FROM drizzle.__drizzle_migrations',
  );
  const recorded = new Set(existing.map((r) => String(r.created_at)));

  let missing = 0;
  for (const entry of journal.entries) {
    if (recorded.has(String(entry.when))) continue;
    missing += 1;

    const sqlPath = path.resolve(__dirname, '..', '..', 'drizzle', `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      console.log(`${entry.tag}: SQL file missing (${entry.tag}.sql) — cannot record, SKIPPED`);
      continue;
    }
    const probes = OBJECT_PROBES[entry.tag] ?? [];
    const missingObjects: string[] = [];
    for (const probe of probes) {
      const r = await client.query('SELECT to_regclass($1) AS reg', [probe]);
      if (!r.rows[0].reg) missingObjects.push(probe);
    }
    if (probes.length && missingObjects.length) {
      console.log(`${entry.tag}: objects missing in DB (${missingObjects.join(', ')}) — NOT recorded (would be a lie)`);
      continue;
    }

    const hash = crypto.createHash('sha256').update(fs.readFileSync(sqlPath)).digest('hex');
    if (!apply) {
      console.log(`${entry.tag}: would record (when=${entry.when}, hash=${hash.slice(0, 12)}…) — dry-run`);
      continue;
    }
    await client.query(
      'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [hash, entry.when],
    );
    console.log(`${entry.tag}: recorded (when=${entry.when})`);
  }

  if (missing === 0) console.log('journal and __drizzle_migrations are consistent — nothing to do');
  console.log(`dry-run: ${!apply}`);

  await client.end();
  if (!apply) {
    console.log('DRY-RUN: pass --apply to write (needs explicit approval).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
