import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const database = process.env.POSTGRES_TEST_DB;
  if (!database || database === process.env.POSTGRES_DB) {
    throw new Error('A dedicated POSTGRES_TEST_DB is required');
  }

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    const result = await pool.query<{
      tables: number;
      trgm: boolean;
      trigram_indexes: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'conversation') AS tables,
        EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS trgm,
        (SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'conversation' AND indexdef ILIKE '%gin%gin_trgm_ops%') AS trigram_indexes
    `);
    const summary = result.rows[0];
    if (summary.tables !== 12 || !summary.trgm || summary.trigram_indexes !== 2) {
      throw new Error(`Unexpected migration summary: ${JSON.stringify(summary)}`);
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Migration test failed'}\n`);
  process.exitCode = 1;
});
