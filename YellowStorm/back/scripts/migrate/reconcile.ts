import { createHash } from 'node:crypto';

/** Deterministic order-independent checksum over a set of ids (integrity check, not crypto). */
export function idChecksum(ids: string[]): string {
  return createHash('md5').update([...ids].sort().join('\n')).digest('hex');
}

export interface ReconcileResult {
  label: string;
  mongoCount: number;
  pgCount: number | null;
  countsMatch: boolean | null;
  checksumMatch: boolean | null;
  /** Sample of ids present in Mongo but missing in Postgres. */
  missingInPg: string[];
  /** Sample of ids present in Postgres but absent from Mongo. */
  extraInPg: string[];
  missingTotal: number;
  extraTotal: number;
}

export interface ReconcileOptions {
  label: string;
  mongoCount: number;
  pgCount?: () => Promise<number>;
  /** Ids seen on the Mongo side during the backfill pass. */
  mongoIds?: string[];
  pgIds?: () => Promise<string[]>;
  sampleLimit?: number;
}

/**
 * Count + checksum reconciliation between a Mongo collection and its Postgres
 * target. Id comparison only runs when both sides supply their id sets.
 */
export async function reconcileCollection(options: ReconcileOptions): Promise<ReconcileResult> {
  const sampleLimit = options.sampleLimit ?? 50;
  const result: ReconcileResult = {
    label: options.label,
    mongoCount: options.mongoCount,
    pgCount: null,
    countsMatch: null,
    checksumMatch: null,
    missingInPg: [],
    extraInPg: [],
    missingTotal: 0,
    extraTotal: 0,
  };

  if (options.pgCount) {
    result.pgCount = await options.pgCount();
    result.countsMatch = result.pgCount === options.mongoCount;
  }

  if (options.mongoIds && options.pgIds) {
    const pgIdSet = new Set(await options.pgIds());
    const mongoIdSet = new Set(options.mongoIds);
    for (const id of mongoIdSet) {
      if (!pgIdSet.has(id)) result.missingInPg.push(id);
    }
    for (const id of pgIdSet) {
      if (!mongoIdSet.has(id)) result.extraInPg.push(id);
    }
    result.missingTotal = result.missingInPg.length;
    result.extraTotal = result.extraInPg.length;
    result.missingInPg = result.missingInPg.slice(0, sampleLimit);
    result.extraInPg = result.extraInPg.slice(0, sampleLimit);
    result.checksumMatch = result.missingTotal === 0 && result.extraTotal === 0;
  }

  return result;
}

export function printReconcile(result: ReconcileResult): void {
  console.log(`=== reconcile: ${result.label} ===`);
  console.log(
    JSON.stringify(
      {
        mongoCount: result.mongoCount,
        pgCount: result.pgCount,
        countsMatch: result.countsMatch,
        checksumMatch: result.checksumMatch,
        missingInPgTotal: result.missingTotal,
        extraInPgTotal: result.extraTotal,
        missingInPgSample: result.missingInPg,
        extraInPgSample: result.extraInPg,
      },
      null,
      2,
    ),
  );
}
