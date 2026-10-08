/**
 * One-time, idempotent backfill: copy the on-disk evaluation run results
 * (`uploads/eval/<evaluationId>/results.json`) into
 * `evaluation.evaluation_result`, so the module can read everything from
 * Postgres (option B) with no dependency on the uploads volume.
 *
 * Missing rows are inserted; existing rows only get their `payload` filled.
 * Rows that already have a payload are left untouched unless `--force` is set.
 *
 * Usage (from `YellowStorm/back`):
 *   npm run backfill:eval-payload                 # insert missing, fill NULL
 *   npm run backfill:eval-payload -- --dry-run    # scan + report, no writes
 *   npm run backfill:eval-payload -- --force      # overwrite existing payloads
 *   npm run backfill:eval-payload -- --only=<evaluationId>
 *   npm run backfill:eval-payload -- --dir=/path/to/uploads/eval
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/modules/postgres/schema';
import { LogicalSearchEvaluationRepository } from '../src/modules/evaluation-logical-search/repositories/logical-search-evaluation.repository';
import type { EvaluationQueryResult } from '../src/modules/evaluation-logical-search/services/evaluation-metrics';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const only = process.argv.find((value) => value.startsWith('--only='))?.split('=')[1];
const dirArg = process.argv.find((value) => value.startsWith('--dir='))?.split('=')[1];

// The service reads runs from `<cwd>/uploads/eval`; resolve it relative to the
// package root so the script works from any working directory.
const uploadsDir = dirArg ? path.resolve(dirArg) : path.resolve(__dirname, '..', 'uploads', 'eval');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  if (!fs.existsSync(uploadsDir)) {
    throw new Error(`Evaluations directory not found: ${uploadsDir}`);
  }

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool, { schema });
  const repository = new LogicalSearchEvaluationRepository(db);

  let runsScanned = 0;
  let runsWithFile = 0;
  let resultsSeen = 0;
  let inserted = 0;
  let updated = 0;
  let skippedExisting = 0;
  let skippedInvalid = 0;
  const errors: string[] = [];

  try {
    const entries = fs
      .readdirSync(uploadsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const evaluationId of entries) {
      if (!UUID_RE.test(evaluationId)) continue;
      if (only && evaluationId !== only) continue;
      runsScanned += 1;

      const resultsFile = path.join(uploadsDir, evaluationId, 'results.json');
      if (!fs.existsSync(resultsFile)) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
      } catch (error) {
        errors.push(`${evaluationId}: cannot parse results.json (${(error as Error).message})`);
        continue;
      }
      if (!Array.isArray(parsed) || parsed.length === 0) continue;
      runsWithFile += 1;

      // Which (evaluation, query) rows already exist, and whether they hold a payload.
      const existing = new Map<string, boolean>();
      const rows = await pool.query<{ query_id: string; has_payload: boolean }>(
        `SELECT query_id, (payload IS NOT NULL) AS has_payload
           FROM evaluation.evaluation_result
          WHERE evaluation_id = $1`,
        [evaluationId],
      );
      for (const row of rows.rows) existing.set(row.query_id, row.has_payload === true);

      let runInserted = 0;
      let runUpdated = 0;
      for (const item of parsed) {
        const result = item as EvaluationQueryResult & { query_id?: unknown };
        if (!result || typeof result !== 'object' || typeof result.query_id !== 'string') {
          skippedInvalid += 1;
          continue;
        }
        resultsSeen += 1;

        const has = existing.get(result.query_id);
        if (has === true && !force) {
          skippedExisting += 1;
          continue;
        }
        if (dryRun) {
          if (has === undefined) runInserted += 1;
          else runUpdated += 1;
          continue;
        }
        try {
          await repository.applyResult(evaluationId, result as EvaluationQueryResult);
          if (has === undefined) {
            inserted += 1;
            runInserted += 1;
          } else {
            updated += 1;
            runUpdated += 1;
          }
        } catch (error) {
          errors.push(`${evaluationId}/${result.query_id}: ${(error as Error).message}`);
        }
      }

      console.log(
        `${dryRun ? '[dry-run] ' : ''}${evaluationId}: ${parsed.length} results, +${runInserted} inserted, ~${runUpdated} updated`,
      );
    }
  } finally {
    await pool.end();
  }

  console.log('\n--- backfill summary ---');
  console.log(`dir:                   ${uploadsDir}`);
  console.log(`runs scanned:          ${runsScanned}`);
  console.log(`runs with results.json:${runsWithFile}`);
  console.log(`results seen:          ${resultsSeen}`);
  console.log(`rows inserted:         ${dryRun ? '(dry-run)' : inserted}`);
  console.log(`rows payload-updated:  ${dryRun ? '(dry-run)' : updated}`);
  console.log(`skipped (already set): ${skippedExisting}`);
  console.log(`invalid/skipped items: ${skippedInvalid}`);
  console.log(`errors:                ${errors.length}`);
  for (const error of errors.slice(0, 20)) console.log(`  - ${error}`);

  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
