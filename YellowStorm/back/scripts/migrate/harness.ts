/**
 * Generic Mongo → Postgres backfill harness.
 *
 * Flags (parsed from argv, shared by every backfill script):
 *   --dry-run          Validate + report, write nothing to Postgres.
 *   --verify           Re-check every migrated unit against Postgres after the run.
 *   --resume-from=<id> Resume strictly after this _id (cursor is sorted by _id asc).
 *   --batch-size=N     Cursor / verification batch size (default 200).
 *   --fix-orphans      Apply each OrphanEdge fixer for reported orphans.
 *   --checksum         Content checksum: per-row sha256 of the transformed Mongo
 *                      row vs the Postgres row read back (needs `checksumRows`).
 *   --strict           Consumers may abort on data they would otherwise skip.
 *
 * Read-only against Mongo (except --fix-orphans), idempotent against Postgres:
 * consumers implement `exists` so re-runs skip already-migrated docs.
 */
import mongoose from 'mongoose';
import { compareRowChecksums, printReconcile, reconcileCollection } from './reconcile';
import { reportOrphans, type OrphanEdge } from './orphans';

export type MongoDoc = Record<string, unknown>;

/** Thrown by `build` to record a doc as failed; `id` feeds the failure report. */
export class BackfillError extends Error {
  constructor(message: string, readonly id = '(no id)') {
    super(message);
  }
}

export interface BackfillFlags {
  dryRun: boolean;
  verify: boolean;
  resumeFrom: string | null;
  batchSize: number;
  fixOrphans: boolean;
  checksum: boolean;
  strict: boolean;
}

export function parseFlags(argv: string[] = process.argv): BackfillFlags {
  return {
    dryRun: argv.includes('--dry-run'),
    verify: argv.includes('--verify'),
    resumeFrom: argv.find((v) => v.startsWith('--resume-from='))?.split('=')[1] ?? null,
    batchSize: Number(argv.find((v) => v.startsWith('--batch-size='))?.split('=')[1] ?? '200'),
    fixOrphans: argv.includes('--fix-orphans'),
    checksum: argv.includes('--checksum'),
    strict: argv.includes('--strict'),
  };
}

export interface BackfillOptions<T> {
  collection: mongoose.mongo.Collection;
  filter?: Record<string, unknown>;
  /** Mongo doc → unit. Throw BackfillError to record a failure. */
  build: (doc: MongoDoc) => T;
  /** Required-field validation; a returned reason records + skips the unit. */
  validate?: (unit: T) => string | null;
  unitId: (unit: T) => string;
  /** Whether the unit's id already exists in Postgres (re-run no-op). */
  exists: (id: string) => Promise<boolean>;
  /** Insert into Postgres. Never called with --dry-run. */
  insert: (unit: T) => Promise<void>;
  /** Drain any consumer-side buffer after iteration. */
  flush?: () => Promise<void>;
  /** Post-run verification: per-unit issue or null. Batched by --batch-size. */
  verify?: (units: T[]) => Promise<Map<string, string>>;
  /** Orphan edges reported after the run (fixed only with --fix-orphans). */
  refs?: OrphanEdge[];
  /** Postgres row count for reconciliation. */
  pgCount?: () => Promise<number>;
  /** Postgres id set for checksum + missing/extra diff. */
  pgIds?: () => Promise<string[]>;
  /**
   * --checksum: Postgres rows for the given ids, as objects comparable to the
   * unit (only the unit's keys are compared; null/undefined are equivalent).
   */
  checksumRows?: (ids: string[]) => Promise<Map<string, Record<string, unknown>>>;
  progressEvery?: number;
}

export interface BackfillStats {
  processed: number;
  inserted: number;
  skippedExisting: number;
  skippedInvalid: number;
  resumeSkipped: number;
  failures: Array<{ id: string; reason: string }>;
  verifyIssues: Array<{ id: string; issue: string }>;
  orphanDocs: Record<string, number>;
}

export async function runBackfill<T>(options: BackfillOptions<T>): Promise<BackfillStats> {
  const flags = parseFlags();
  if (flags.dryRun && flags.fixOrphans) {
    throw new Error('--fix-orphans conflicts with --dry-run: a dry-run never writes, including Mongo fixers. Drop --dry-run to apply fixes.');
  }
  const stats: BackfillStats = {
    processed: 0,
    inserted: 0,
    skippedExisting: 0,
    skippedInvalid: 0,
    resumeSkipped: 0,
    failures: [],
    verifyIssues: [],
    orphanDocs: {},
  };
  const progressEvery = options.progressEvery ?? 1000;
  const mongoIds: string[] = [];

  const checksumUnits = new Map<string, Record<string, unknown>>();
  const cursorFilter = resumeFilter(options.filter, flags.resumeFrom);
  if (flags.resumeFrom !== null) {
    stats.resumeSkipped =
      (await options.collection.countDocuments(options.filter ?? {})) -
      (await options.collection.countDocuments(cursorFilter));
  }
  // Sorted by _id so --resume-from (strictly greater) is deterministic across runs.
  const cursor = options.collection.find(cursorFilter, { batchSize: flags.batchSize }).sort({ _id: 1 });

  for await (const doc of cursor) {
    stats.processed += 1;
    if (stats.processed % progressEvery === 0) {
      console.log(`[progress] processed=${stats.processed} inserted=${stats.inserted} failed=${stats.failures.length}`);
    }

    let unit: T;
    try {
      unit = options.build(doc as MongoDoc);
    } catch (error: unknown) {
      const err = error instanceof BackfillError ? error : new BackfillError(String(error));
      stats.failures.push({ id: err.id, reason: err.message });
      continue;
    }
    mongoIds.push(options.unitId(unit));
    if (flags.checksum && options.checksumRows) {
      checksumUnits.set(options.unitId(unit), unit as unknown as Record<string, unknown>);
    }

    const reason = options.validate?.(unit) ?? null;
    if (reason) {
      stats.skippedInvalid += 1;
      stats.failures.push({ id: options.unitId(unit), reason });
      continue;
    }

    try {
      if (await options.exists(options.unitId(unit))) {
        stats.skippedExisting += 1;
      } else if (!flags.dryRun) {
        await options.insert(unit);
        stats.inserted += 1;
      }
    } catch (error: unknown) {
      stats.failures.push({ id: options.unitId(unit), reason: error instanceof Error ? error.message : String(error) });
    }
  }
  await options.flush?.();

  if (flags.resumeFrom !== null && stats.processed === 0) {
    stats.failures.push({ id: flags.resumeFrom, reason: '--resume-from: no document after this _id; nothing processed' });
  }

  if (flags.verify && options.verify) {
    await verifyAll(options, flags.batchSize, stats);
  }

  if (options.refs?.length) {
    const report = await reportOrphans(options.collection, options.refs, { fix: flags.fixOrphans });
    for (const item of report) {
      stats.orphanDocs[item.label] = item.orphanDocs;
      console.log(`=== orphans: ${item.label} ===`);
      console.log(JSON.stringify({ orphanDocs: item.orphanDocs, fixed: item.fixed, sample: item.sample }, null, 2));
    }
  }

  const mongoCount = await options.collection.countDocuments(options.filter ?? {});
  const reconcile = await reconcileCollection({
    label: options.collection.collectionName,
    mongoCount,
    pgCount: options.pgCount,
    mongoIds: options.pgIds ? mongoIds : undefined,
    pgIds: options.pgIds,
  });
  printReconcile(reconcile);

  if (flags.checksum) {
    if (!options.checksumRows) {
      console.log(`=== checksum: ${options.collection.collectionName} === skipped (no checksumRows provided)`);
    } else {
      const ids = [...checksumUnits.keys()];
      const pgRows = new Map<string, Record<string, unknown>>();
      for (let i = 0; i < ids.length; i += flags.batchSize) {
        for (const [id, row] of await options.checksumRows(ids.slice(i, i + flags.batchSize))) pgRows.set(id, row);
      }
      const checksum = compareRowChecksums(checksumUnits, pgRows);
      console.log(`=== checksum: ${options.collection.collectionName} ===`);
      console.log(JSON.stringify(checksum, null, 2));
      if (!checksum.match) {
        stats.failures.push({ id: '(checksum)', reason: `${checksum.mismatchTotal} row(s) differ between Mongo and Postgres` });
      }
    }
  }

  console.log('=== backfill ===');
  console.log(
    JSON.stringify(
      {
        dryRun: flags.dryRun,
        processed: stats.processed,
        inserted: stats.inserted,
        skippedExisting: stats.skippedExisting,
        skippedInvalid: stats.skippedInvalid,
        resumeSkipped: stats.resumeSkipped,
        failed: stats.failures.length,
      },
      null,
      2,
    ),
  );
  if (stats.failures.length) {
    console.log('--- failures ---');
    for (const f of stats.failures) console.log(`  ${f.id}: ${f.reason}`);
  }
  return stats;
}

async function verifyAll<T>(options: BackfillOptions<T>, batchSize: number, stats: BackfillStats): Promise<void> {
  const verify = options.verify;
  if (!verify) return;
  const cursor = options.collection
    .find(resumeFilter(options.filter, parseFlags().resumeFrom), { batchSize })
    .sort({ _id: 1 });
  let batch: T[] = [];
  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const issues = await verify(batch);
    for (const [id, issue] of issues) stats.verifyIssues.push({ id, issue });
    batch = [];
  };
  for await (const doc of cursor) {
    try {
      batch.push(options.build(doc as MongoDoc));
    } catch {
      // Already recorded as a failure by the main pass; skip in verification.
    }
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  if (stats.verifyIssues.length) {
    console.log('--- verify problems ---');
    for (const p of stats.verifyIssues) console.log(`  ${p.id}: ${p.issue}`);
  }
}

/** `filter AND _id > resumeFrom` (as an ObjectId when the value is one, else raw). */
export function resumeFilter(
  filter: Record<string, unknown> | undefined,
  resumeFrom: string | null,
): Record<string, unknown> {
  const base = filter ?? {};
  if (resumeFrom === null) return base;
  const after = /^[0-9a-fA-F]{24}$/.test(resumeFrom) ? new mongoose.Types.ObjectId(resumeFrom) : resumeFrom;
  const idClause = { _id: { $gt: after } };
  return Object.keys(base).length === 0 ? idClause : { $and: [base, idClause] };
}
