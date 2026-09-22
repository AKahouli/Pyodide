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

/**
 * Stable serialisation for content checksums: object keys sorted, Dates as
 * ISO strings, null/undefined properties dropped (Mongo "absent" == PG NULL).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.toHexString === 'function') return (obj.toHexString as () => string)();
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === null || obj[key] === undefined) continue;
      out[key] = canonical(obj[key]);
    }
    return out;
  }
  return value;
}

/** sha256 of the canonical row. */
export function rowHash(row: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(row)).digest('hex');
}

/** Restrict `row` to `keys` so PG-only columns (defaults) do not skew the hash. */
export function projectKeys(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = row[key];
  return out;
}

/** Order-independent aggregate over per-row hashes. */
export function aggregateChecksum(hashes: Map<string, string>): string {
  const lines = [...hashes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, h]) => `${id}:${h}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export interface RowChecksumResult {
  mongoChecksum: string;
  pgChecksum: string;
  match: boolean;
  compared: number;
  /** Mongo rows with no PG row (also in the id diff; counted as mismatches here). */
  missingInPg: number;
  mismatchTotal: number;
  /** First N ids whose content hash differs or that are missing in PG. */
  mismatchSample: string[];
}

/**
 * Content checksum: hash each transformed Mongo row and its PG read-back
 * (projected onto the Mongo row's keys), then compare the aggregates.
 */
export function compareRowChecksums(
  mongoRows: Map<string, Record<string, unknown>>,
  pgRows: Map<string, Record<string, unknown>>,
  sampleLimit = 50,
): RowChecksumResult {
  const mongoHashes = new Map<string, string>();
  const pgHashes = new Map<string, string>();
  const mismatches: string[] = [];
  let missingInPg = 0;
  for (const [id, mongoRow] of mongoRows) {
    const keys = Object.keys(mongoRow);
    const mHash = rowHash(mongoRow);
    mongoHashes.set(id, mHash);
    const pgRow = pgRows.get(id);
    if (!pgRow) {
      missingInPg += 1;
      mismatches.push(id);
      continue;
    }
    const pHash = rowHash(projectKeys(pgRow, keys));
    pgHashes.set(id, pHash);
    if (pHash !== mHash) mismatches.push(id);
  }
  const mongoChecksum = aggregateChecksum(mongoHashes);
  const pgChecksum = aggregateChecksum(pgHashes);
  return {
    mongoChecksum,
    pgChecksum,
    match: mismatches.length === 0 && mongoChecksum === pgChecksum,
    compared: mongoRows.size,
    missingInPg,
    mismatchTotal: mismatches.length,
    mismatchSample: mismatches.slice(0, sampleLimit),
  };
}
