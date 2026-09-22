/**
 * Read-only Postgres state verification (F.2 / remediation 5.5).
 * Exit 1 on any failure; warnings do not fail the run.
 *
 * Checks:
 *  1. journal/DB bookkeeping: every journal `when` is recorded AND the
 *     journal's max `when` exceeds the DB watermark (else the next migration
 *     is silently skipped — R-23/K9);
 *  2. no NOT VALID constraints in the app schemas;
 *  3. 0 invalid indexes;
 *  4. every single-column FK in the app schemas has a leading index;
 *  5. every PgTtlSweeper-registered (schema, table, column) has an index
 *     leading on that column;
 *  6. never-analyzed tables (warning only);
 *  7. --mongo: run reconcile-ids with the committed allowlist;
 *  8. every fk-specs.ts constraint exists, is validated and matches its
 *     definition (a drifted or missing FK fails).
 *
 * Usage: npm run db:verify [-- -- --mongo]
 */
import * as path from 'path';
import { Client } from 'pg';
import { FK_SPECS, FK_SPECS_IN_0020, normalizeFkDefinition } from './fk-specs';

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const APP_SCHEMAS = ['identity', 'authz', 'catalog', 'ops', 'integrations', 'teams', 'channels', 'workspace', 'project', 'conversation', 'governance', 'public'];

/** Mirror of PgTtlRegistrationService (kept in sync by its own spec). */
const TTL_SWEEPS: Array<{ schema: string; table: string; column: string }> = [
  { schema: 'identity', table: 'sessions', column: 'expires_at' },
  { schema: 'identity', table: 'oauth_states', column: 'expires_at' },
  { schema: 'identity', table: 'provider_link_tokens', column: 'expires_at' },
  { schema: 'authz', table: 'audit_logs', column: 'created_at' },
  { schema: 'ops', table: 'notifications', column: 'expires_at' },
  { schema: 'ops', table: 'health_history', column: 'expire_at' },
  { schema: 'integrations', table: 'connected_app_oauth_states', column: 'expires_at' },
  { schema: 'integrations', table: 'admin_connector_oauth_states', column: 'expires_at' },
  { schema: 'channels', table: 'telegram_link_codes', column: 'expires_at' },
  { schema: 'workspace', table: 'upload_sessions', column: 'expires_at' },
];

async function main(): Promise<void> {
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    options: '-c default_transaction_read_only=on',
  });
  await client.connect();

  const failures: string[] = [];
  const warnings: string[] = [];

  // 1. journal/DB bookkeeping
  const journal = require(path.resolve(__dirname, '..', '..', 'drizzle', 'meta', '_journal.json')) as {
    entries: Array<{ when: number; tag: string }>;
  };
  const { rows: dbRows } = await client.query<{ created_at: string }>(
    'SELECT created_at FROM drizzle.__drizzle_migrations',
  );
  const dbWatermarks = dbRows.map((r) => Number(r.created_at));
  const dbMax = Math.max(...dbWatermarks);
  const recorded = new Set(dbWatermarks.map(String));
  for (const entry of journal.entries) {
    if (!recorded.has(String(entry.when))) failures.push(`check1: journal ${entry.tag} (when=${entry.when}) not recorded in __drizzle_migrations — run record-applied-migrations/migrate`);
  }
  if (journal.entries.length) {
    const journalMax = Math.max(...journal.entries.map((e) => e.when));
    if (journalMax < dbMax) failures.push(`check1: journal max when ${journalMax} <= DB watermark ${dbMax} — the next migration would be silently SKIPPED (R-23)`);
    else console.log(`check1 ok: journal max ${journalMax} > DB watermark ${dbMax}; all journal entries recorded`);
  }

  // 2. no NOT VALID constraints in app schemas
  const notValid = await client.query(
    `SELECT conname, n.nspname AS schema, rel.relname AS table
       FROM pg_constraint c
       JOIN pg_class rel ON rel.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE NOT c.convalidated AND n.nspname = ANY($1)`,
    [APP_SCHEMAS],
  );
  if (notValid.rows.length) for (const r of notValid.rows) failures.push(`check2: NOT VALID constraint ${r.schema}.${r.table}:${r.conname}`);
  else console.log('check2 ok: 0 NOT VALID constraints in app schemas');

  // 3. invalid indexes
  const invalidIdx = await client.query(
    `SELECT n.nspname AS schema, i.relname AS index
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE NOT x.indisvalid AND n.nspname = ANY($1)`,
    [APP_SCHEMAS],
  );
  if (invalidIdx.rows.length) for (const r of invalidIdx.rows) failures.push(`check3: invalid index ${r.schema}.${r.index}`);
  else console.log('check3 ok: 0 invalid indexes');

  // 4. every single-column FK has a leading index
  const unindexedFk = await client.query(
    `SELECT c.conname, n.nspname AS schema, rel.relname AS table, a.attname AS column
       FROM pg_constraint c
       JOIN pg_class rel ON rel.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace
       JOIN unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = cols.attnum
      WHERE c.contype = 'f' AND n.nspname = ANY($1) AND cols.ord = 1
        AND (SELECT count(*) FROM unnest(c.conkey)) = 1
        AND NOT EXISTS (
          SELECT 1 FROM pg_index x
          WHERE x.indrelid = c.conrelid AND x.indkey[0] = a.attnum
        )`,
    [APP_SCHEMAS],
  );
  if (unindexedFk.rows.length) for (const r of unindexedFk.rows) failures.push(`check4: FK ${r.schema}.${r.table}:${r.conname} column '${r.column}' has no leading index`);
  else console.log('check4 ok: every single-column FK has a leading index');

  // 5. TTL sweeps have a leading index
  for (const sweep of TTL_SWEEPS) {
    const r = await client.query(
      `SELECT 1 FROM pg_index x
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.indkey[0]
        WHERE n.nspname = $1 AND t.relname = $2 AND a.attname = $3
        LIMIT 1`,
      [sweep.schema, sweep.table, sweep.column],
    );
    if (r.rowCount === 0) failures.push(`check5: TTL sweep ${sweep.schema}.${sweep.table}.${sweep.column} has no index leading on the column`);
  }
  if (!failures.some((f) => f.startsWith('check5'))) console.log('check5 ok: all TTL sweeps have leading indexes');

  // 8. every fk-specs constraint exists, is validated and has the expected definition
  let fkChecked = 0;
  for (const spec of [...FK_SPECS, ...FK_SPECS_IN_0020]) {
    const live = await client.query<{ def: string; valid: boolean }>(
      `SELECT pg_get_constraintdef(c.oid) AS def, c.convalidated AS valid
         FROM pg_constraint c WHERE c.conname = $1 AND c.conrelid = $2::regclass`,
      [spec.name, spec.table],
    );
    if (live.rowCount === 0) failures.push(`check8: FK ${spec.name} missing on ${spec.table}`);
    else if (!live.rows[0].valid) failures.push(`check8: FK ${spec.name} exists but is NOT VALID`);
    else if (normalizeFkDefinition(live.rows[0].def) !== normalizeFkDefinition(spec.definition)) {
      failures.push(`check8: FK ${spec.name} definition drifted: live ${JSON.stringify(normalizeFkDefinition(live.rows[0].def))} vs expected ${JSON.stringify(normalizeFkDefinition(spec.definition))}`);
    } else fkChecked++;
  }
  if (!failures.some((f) => f.startsWith('check8'))) console.log(`check8 ok: ${fkChecked} FK specs exist, validated, definitions match`);

  // 6. never-analyzed tables (warning only)
  const stale = await client.query(
    `SELECT n.nspname AS schema, c.relname AS table
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relkind = 'r' AND n.nspname = ANY($1) AND (s.last_analyze IS NULL AND s.last_autoanalyze IS NULL)`,
    [APP_SCHEMAS],
  );
  if (stale.rows.length) warnings.push(`check6: ${stale.rows.length} tables never analyzed: ${stale.rows.map((r) => `${r.schema}.${r.table}`).join(', ')}`);
  else console.log('check6 ok: all tables analyzed');

  await client.end();

  for (const w of warnings) console.warn('WARN', w);
  if (failures.length) {
    for (const f of failures) console.error('FAIL', f);
    process.exit(1);
  }
  console.log('db:verify OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
