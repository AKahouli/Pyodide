/**
 * Shared runner for the cross-schema FK scripts (2026-09-*-fk.ts).
 *
 * For each spec: add the constraint NOT VALID if missing, REPLACE it if its live
 * definition no longer matches (e.g. an older run created it without ON DELETE),
 * report orphans, and VALIDATE only when none remain. Retired constraints are
 * dropped. `--drop` removes every managed constraint (module rollback).
 *
 * The canonical definitions live in drizzle/0020_fk_actions_and_missing_indexes.sql;
 * these scripts must stay in sync with it.
 *
 * A single dedicated connection is used with lock_timeout set, so an ALTER TABLE
 * never queues behind live traffic holding its ACCESS EXCLUSIVE lock.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

export interface FkSpec {
  name: string;
  table: string;
  /** Constraint body as pg_get_constraintdef() renders it, without NOT VALID. */
  definition: string;
  orphanCheck: string;
}

export interface RetiredFk {
  name: string;
  table: string;
  reason: string;
}

const LOCK_TIMEOUT_MS = Number(process.env.FK_LOCK_TIMEOUT_MS || '5000');

const normalize = (def: string): string => def.replace(/\s+/g, ' ').replace(/ NOT VALID$/, '').trim();

export async function runFkSpecs(specs: FkSpec[], retired: RetiredFk[] = []): Promise<void> {
  const drop = process.argv.includes('--drop');
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
      await client.query(`ALTER TABLE ${r.table} DROP CONSTRAINT IF EXISTS ${r.name}`);
      console.log(`${r.name}: retired (${r.reason})`);
    }

    if (drop) {
      for (const spec of specs) {
        await client.query(`ALTER TABLE ${spec.table} DROP CONSTRAINT IF EXISTS ${spec.name}`);
        console.log(`${spec.name}: dropped from ${spec.table}`);
      }
      return;
    }

    for (const spec of specs) {
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

      const { rows } = await client.query<{ n: number }>(spec.orphanCheck);
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
