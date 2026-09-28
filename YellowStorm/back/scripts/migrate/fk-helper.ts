/**
 * Shared runner for the cross-schema FK scripts (scripts/migrate/*-fk.ts).
 *
 * For each spec: add the constraint NOT VALID if missing, REPLACE it if its live
 * definition no longer matches (e.g. an older run created it without ON DELETE),
 * report orphans, and VALIDATE only when none remain. Retired constraints are
 * dropped.
 *
 * Specs come from fk-specs.ts (single source: drizzle/0025 is generated from it and
 * drizzle/0020 carries FK_SPECS_IN_0020). Flags:
 *   --dry-run         report orphans only, change nothing
 *   --delete-orphans  export then delete dangling rows for specs that carry a
 *                     `cleanup` (never without the JSON export)
 *   --keep-orphans=a,b  with --delete-orphans, leave the dangling rows of the named
 *                     specs alone (the constraint stays NOT VALID and the exit code is 1)
 *   --drop            remove every managed constraint (module rollback)
 *
 * A single dedicated connection is used with lock_timeout set, so an ALTER TABLE
 * never queues behind live traffic holding its ACCESS EXCLUSIVE lock. Re-running on a
 * live database is a no-op: validated, up-to-date constraints are left untouched.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { normalizeFkDefinition as normalize, type FkSpec } from './fk-specs';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

export type { FkSpec } from './fk-specs';

export interface RetiredFk {
  name: string;
  table: string;
  reason: string;
}

const LOCK_TIMEOUT_MS = Number(process.env.FK_LOCK_TIMEOUT_MS || '5000');

export async function runFkSpecs(specs: FkSpec[], retired: RetiredFk[] = []): Promise<void> {
  const drop = process.argv.includes('--drop');
  const dryRun = process.argv.includes('--dry-run');
  const deleteOrphans = process.argv.includes('--delete-orphans');
  const keepOrphans = new Set(
    (process.argv.find((a) => a.startsWith('--keep-orphans='))?.slice('--keep-orphans='.length) ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean),
  );
  for (const name of keepOrphans) {
    if (!specs.some((s) => s.name === name)) throw new Error(`--keep-orphans: no spec named ${name} in this script`);
  }
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    options: `-c lock_timeout=${LOCK_TIMEOUT_MS}`,
    application_name: 'fk-migration-script',
  });
  await client.connect();

  let exitCode = 0;
  try {
    for (const r of retired) {
      if (dryRun) {
        console.log(`${r.name}: would retire (${r.reason})`);
        continue;
      }
      await client.query(`ALTER TABLE ${r.table} DROP CONSTRAINT IF EXISTS ${r.name}`);
      console.log(`${r.name}: retired (${r.reason})`);
    }

    if (drop && !dryRun) {
      for (const spec of specs) {
        await client.query(`ALTER TABLE ${spec.table} DROP CONSTRAINT IF EXISTS ${spec.name}`);
        console.log(`${spec.name}: dropped from ${spec.table}`);
      }
      return;
    }

    for (const spec of specs) {
      if (dryRun) {
        const { rows: probe } = await client.query<{ n: number }>(spec.orphanCheck);
        console.log(`${spec.name}: ${probe[0].n} orphan refs (dry-run, nothing changed)`);
        if (probe[0].n > 0) exitCode = 1;
        continue;
      }

      const { rows: live } = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c
          WHERE c.conname = $1 AND c.conrelid = $2::regclass`,
        [spec.name, spec.table],
      );

      if (live.length && normalize(live[0].def) !== normalize(spec.definition)) {
        await client.query(`ALTER TABLE ${spec.table} DROP CONSTRAINT ${spec.name}`);
        console.log(`${spec.name}: definition drifted (${normalize(live[0].def)}) — replaced`);
        live.length = 0;
      }
      if (!live.length) {
        await client.query(`ALTER TABLE ${spec.table} ADD CONSTRAINT ${spec.name} ${spec.definition} NOT VALID`);
        console.log(`${spec.name}: added (NOT VALID)`);
      } else {
        console.log(`${spec.name}: already up to date`);
      }

      let { rows } = await client.query<{ n: number }>(spec.orphanCheck);
      if (rows[0].n > 0 && spec.cleanup) {
        if (!deleteOrphans) {
          console.log(
            `${spec.name}: ${rows[0].n} orphan refs — rerun with --delete-orphans to export + delete (opt-in)`,
          );
        } else if (keepOrphans.has(spec.name)) {
          console.log(`${spec.name}: ${rows[0].n} orphan refs kept on purpose (--keep-orphans), nothing deleted`);
        } else {
          const dangling = await client.query(spec.cleanup.selectSql);
          const outDir = path.resolve(__dirname, 'out');
          fs.mkdirSync(outDir, { recursive: true });
          const file = path.join(
            outDir,
            `${spec.cleanup.exportStem}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
          );
          fs.writeFileSync(file, JSON.stringify(dangling.rows, null, 2));
          console.log(`${spec.name}: exported ${dangling.rowCount} dangling rows → ${file}`);
          const removed = await client.query(spec.cleanup.deleteSql);
          console.log(`${spec.name}: deleted ${removed.rowCount} dangling rows`);
          rows = (await client.query<{ n: number }>(spec.orphanCheck)).rows;
        }
      }
      if (rows[0].n === 0) {
        await client.query(`ALTER TABLE ${spec.table} VALIDATE CONSTRAINT ${spec.name}`);
        console.log(`${spec.name}: validated (0 orphan refs)`);
      } else {
        console.log(`${spec.name}: ${rows[0].n} orphan refs — left NOT VALID`);
        exitCode = 1;
      }
    }
  } finally {
    await client.end();
  }
  if (exitCode) process.exitCode = exitCode;
}
