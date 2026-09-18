/**
 * Generic Mongo → Postgres backfill harness.
 *
 * Flags (parsed from argv, shared by every backfill script):
 *   --dry-run          Validate + report, write nothing to Postgres.
 *   --verify           Re-check every migrated unit against Postgres after the run.
 *   --resume-from=<id> Skip Mongo docs until the doc with this _id (inclusive).
 *   --batch-size=N     Cursor / verification batch size (default 200).
 *   --fix-orphans      Apply each OrphanEdge fixer for reported orphans.
 *
 * Read-only against Mongo (except --fix-orphans), idempotent against Postgres:
 * consumers implement `exists` so re-runs skip already-migrated docs.
 */
import type mongoose from 'mongoose';
import { printReconcile, reconcileCollection } from './reconcile';
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
}

export function parseFlags(argv: string[] = process.argv): BackfillFlags {
  return {
    dryRun: argv.includes('--dry-run'),
    verify: argv.includes('--verify'),
    resumeFrom: argv.find((v) => v.startsWith('--resume-from='))?.split('=')[1] ?? null,
    batchSize: Number(argv.find((v) => v.startsWith('--batch-size='))?.split('=')[1] ?? '200'),
    fixOrphans: argv.includes('--fix-orphans'),
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

  let resuming = flags.resumeFrom !== null;
  const cursor = options.collection.find(options.filter ?? {}, { batchSize: flags.batchSize });

  for await (const doc of cursor) {
    if (resuming) {
      if (String(doc._id) !== flags.resumeFrom) {
        stats.resumeSkipped += 1;
        continue;
      }
      resuming = false;
    }
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
    stats.failures.push({ id: flags.resumeFrom, reason: '--resume-from matched no document; nothing processed' });
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
  const cursor = options.collection.find(options.filter ?? {}, { batchSize });
  let batch: T[] = [];
  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const issues = await verify(batch);
    for (const [id, issue] of issues) stats.verifyIssues.push({ id, issue });
    batch = [];
  };
  let resuming = parseFlags().resumeFrom !== null;
  for await (const doc of cursor) {
    if (resuming) {
      if (String(doc._id) !== parseFlags().resumeFrom) continue;
      resuming = false;
    }
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
