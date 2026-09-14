/**
 * One-time, idempotent backfill from Mongo `usage`/`usage_logs` to Postgres.
 * Mongo is read-only; existing Postgres rows are never overwritten.
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../src/modules/postgres/schema';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const mongoUri = process.env.MONGODB_URI ?? '';
if (!mongoUri) throw new Error('MONGODB_URI is required');
const dryRun = process.argv.includes('--dry-run');
const verify = process.argv.includes('--verify');
const batchSize = Number(
  process.argv.find((value) => value.startsWith('--batch-size='))?.split('=')[1] ?? '200',
);
if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('--batch-size must be positive');

type MongoDoc = Record<string, unknown>;

const stringValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof mongoose.mongo.ObjectId) return value.toHexString();
  throw new Error(`Unsupported string value type: ${typeof value}`);
};
const optionalString = (value: unknown): string | undefined =>
  value == null ? undefined : stringValue(value);
const dateValue = (value: unknown): Date => {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date(Number.NaN);
};
const numberValue = (value: unknown): number => Number(value ?? 0);

async function migrateCollection(
  name: 'usage' | 'usage_logs',
  collection: mongoose.mongo.Collection,
  db: ReturnType<typeof drizzle<typeof schema>>,
): Promise<{ processed: number; inserted: number; skipped: number; failures: string[] }> {
  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  const failures: string[] = [];
  let batch: MongoDoc[] = [];

  const flush = async () => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];
    if (name === 'usage') {
      const mapped = rows.map(mapUsageWindow);
      mapped.forEach(validateUsageWindow);
      if (dryRun) return;
      try {
        const result = await db
          .insert(schema.usageWindows)
          .values(mapped)
          .onConflictDoNothing({ target: schema.usageWindows.id })
          .returning({ id: schema.usageWindows.id });
        inserted += result.length;
        skipped += rows.length - result.length;
      } catch {
        for (const row of mapped) {
          const result = await insertUsageWindow(row, db, failures);
          if (result === 'inserted') inserted += 1;
          if (result === 'skipped') skipped += 1;
        }
      }
      return;
    }
    const mapped = rows.map(mapUsageLog);
    mapped.forEach(validateUsageLog);
    if (dryRun) return;
    try {
      const result = await db
        .insert(schema.usageLogs)
        .values(mapped)
        .onConflictDoNothing({ target: schema.usageLogs.id })
        .returning({ id: schema.usageLogs.id });
      inserted += result.length;
      skipped += rows.length - result.length;
    } catch {
      for (const row of mapped) {
        const result = await insertUsageLog(row, db, failures);
        if (result === 'inserted') inserted += 1;
        if (result === 'skipped') skipped += 1;
      }
    }
  };

  for await (const doc of collection.find({}).batchSize(batchSize)) {
    processed += 1;
    const id = stringValue(doc._id);
    if (!/^[0-9a-f]{24}$/.test(id)) {
      failures.push(`${name}:${id || '(missing id)'} invalid id`);
      continue;
    }
    batch.push(doc);
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  return { processed, inserted, skipped, failures };
}

async function insertUsageWindow(
  row: typeof schema.usageWindows.$inferInsert,
  db: ReturnType<typeof drizzle<typeof schema>>,
  failures: string[],
): Promise<'inserted' | 'skipped' | 'failed'> {
  try {
    const inserted = await db
      .insert(schema.usageWindows)
      .values(row)
      .onConflictDoNothing({ target: schema.usageWindows.id })
      .returning({ id: schema.usageWindows.id });
    return inserted.length ? 'inserted' : 'skipped';
  } catch (error) {
    failures.push(`usage:${row.id} ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  }
}

async function insertUsageLog(
  row: typeof schema.usageLogs.$inferInsert,
  db: ReturnType<typeof drizzle<typeof schema>>,
  failures: string[],
): Promise<'inserted' | 'skipped' | 'failed'> {
  try {
    const inserted = await db
      .insert(schema.usageLogs)
      .values(row)
      .onConflictDoNothing({ target: schema.usageLogs.id })
      .returning({ id: schema.usageLogs.id });
    return inserted.length ? 'inserted' : 'skipped';
  } catch (error) {
    failures.push(`usage_logs:${row.id} ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  }
}

function mapUsageWindow(doc: MongoDoc): typeof schema.usageWindows.$inferInsert {
  return {
    id: stringValue(doc._id),
    userId: stringValue(doc.userId),
    windowStart: dateValue(doc.windowStart),
    windowEnd: dateValue(doc.windowEnd),
    windowHours: numberValue(doc.windowHours),
    inputTokens: numberValue(doc.inputTokens),
    outputTokens: numberValue(doc.outputTokens),
    totalTokens: numberValue(doc.totalTokens),
    requestCount: numberValue(doc.requestCount),
    planId: optionalString(doc.planId),
    planSlug: optionalString(doc.planSlug),
    tokenLimitAtCreation:
      doc.tokenLimitAtCreation == null ? undefined : numberValue(doc.tokenLimitAtCreation),
    createdAt: dateValue(doc.createdAt),
    updatedAt: dateValue(doc.updatedAt),
  };
}

function validateUsageWindow(row: typeof schema.usageWindows.$inferInsert): void {
  if (!row.userId || row.userId.length > 100) throw new Error(`usage:${row.id} invalid userId`);
  if (
    !Number.isFinite(row.windowStart.getTime()) ||
    !Number.isFinite(row.windowEnd.getTime()) ||
    row.windowEnd <= row.windowStart
  ) {
    throw new Error(`usage:${row.id} invalid window`);
  }
  if (!isPgNonNegativeInt(row.windowHours) || row.windowHours < 1) {
    throw new Error(`usage:${row.id} invalid windowHours`);
  }
  if (
    [row.inputTokens, row.outputTokens, row.totalTokens, row.requestCount].some(
      (value) => !isPgNonNegativeInt(value ?? 0),
    )
  ) {
    throw new Error(`usage:${row.id} negative counters`);
  }
  if (row.planSlug && row.planSlug.length > 50)
    throw new Error(`usage:${row.id} planSlug too long`);
}

function mapUsageLog(doc: MongoDoc): typeof schema.usageLogs.$inferInsert {
  return {
    id: stringValue(doc._id),
    userId: stringValue(doc.userId),
    usageType: optionalString(doc.usageType) ?? 'chat',
    modelName: optionalString(doc.modelName),
    inputTokens: numberValue(doc.inputTokens),
    outputTokens: numberValue(doc.outputTokens),
    totalTokens: numberValue(doc.totalTokens),
    durationMs: doc.durationMs == null ? undefined : numberValue(doc.durationMs),
    conversationId: optionalString(doc.conversationId),
    endpoint: optionalString(doc.endpoint),
    ipAddress: optionalString(doc.ipAddress),
    userAgent: optionalString(doc.userAgent),
    success: doc.success == null ? true : Boolean(doc.success),
    errorCode: optionalString(doc.errorCode),
    metadata:
      doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
        ? doc.metadata
        : {},
    createdAt: dateValue(doc.createdAt),
    updatedAt: dateValue(doc.updatedAt),
  };
}

function validateUsageLog(row: typeof schema.usageLogs.$inferInsert): void {
  const types = new Set(['chat', 'completion', 'embedding', 'playbook', 'other']);
  if (!row.userId || row.userId.length > 100)
    throw new Error(`usage_logs:${row.id} invalid userId`);
  if (!types.has(row.usageType ?? 'chat'))
    throw new Error(`usage_logs:${row.id} invalid usageType`);
  if (
    [row.inputTokens, row.outputTokens, row.totalTokens, row.durationMs ?? 0].some(
      (value) => !isPgNonNegativeInt(value),
    )
  ) {
    throw new Error(`usage_logs:${row.id} negative metrics`);
  }
  if (!Number.isFinite(row.createdAt?.getTime()) || !Number.isFinite(row.updatedAt?.getTime())) {
    throw new Error(`usage_logs:${row.id} invalid timestamps`);
  }
}

function isPgNonNegativeInt(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
}

async function verifyCollection(
  name: 'usage' | 'usage_logs',
  collection: mongoose.mongo.Collection,
  db: ReturnType<typeof drizzle<typeof schema>>,
): Promise<number> {
  let missing = 0;
  let ids: string[] = [];
  const flush = async () => {
    if (!ids.length) return;
    const table = name === 'usage' ? schema.usageWindows : schema.usageLogs;
    const rows = await db.select({ id: table.id }).from(table).where(inArray(table.id, ids));
    const found = new Set(rows.map((row) => row.id.trim()));
    missing += ids.filter((id) => !found.has(id)).length;
    ids = [];
  };
  for await (const doc of collection.find({}, { projection: { _id: 1 } }).batchSize(batchSize)) {
    ids.push(stringValue(doc._id));
    if (ids.length >= batchSize) await flush();
  }
  await flush();
  return missing;
}

async function main(): Promise<void> {
  await mongoose.connect(mongoUri);
  const mongo = mongoose.connection.db;
  if (!mongo) throw new Error('MongoDB connection is not ready');
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 4,
  });
  try {
    const db = drizzle(pool, { schema });
    const usage = await migrateCollection('usage', mongo.collection('usage'), db);
    const logs = await migrateCollection('usage_logs', mongo.collection('usage_logs'), db);
    const result = { dryRun, usage, logs };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (verify) {
      const missingUsage = await verifyCollection('usage', mongo.collection('usage'), db);
      const missingLogs = await verifyCollection('usage_logs', mongo.collection('usage_logs'), db);
      process.stdout.write(`${JSON.stringify({ missingUsage, missingLogs })}\n`);
      if (missingUsage || missingLogs) process.exitCode = 1;
    }
    if (usage.failures.length || logs.failures.length) process.exitCode = 1;
  } finally {
    await pool.end();
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Usage backfill failed'}\n`);
  process.exitCode = 1;
});
