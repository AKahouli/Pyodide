import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 1,
  });
  const column = await pool.query<{ type: string }>(`
    SELECT format_type(attribute.atttypid, attribute.atttypmod) AS type
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    WHERE relation.relname = 'agents' AND attribute.attname = 'role_embedding'
  `);
  const migrations = await pool.query<{ id: number; created_at: string }>(
    'SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
  );
  const embeddings = await pool.query<{ total: string; embedded: string; dimensions: number | null }>(`
    SELECT
      COUNT(*)::text AS total,
      COUNT(role_embedding)::text AS embedded,
      MIN(vector_dims(role_embedding)) AS dimensions
    FROM agents
    WHERE agent_type_slug = 'humain'
  `);
  console.log({
    columnType: column.rows[0]?.type,
    embeddings: embeddings.rows[0],
    migrations: migrations.rows,
  });
  await pool.end();
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
