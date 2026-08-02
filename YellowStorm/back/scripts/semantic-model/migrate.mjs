import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const directory = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const pool = new Pool({
  host: process.env.SEMANTIC_PG_HOST,
  port: Number(process.env.SEMANTIC_PG_PORT || 5432),
  user: process.env.SEMANTIC_PG_USER,
  password: process.env.SEMANTIC_PG_PASSWORD,
  database: process.env.SEMANTIC_PG_DATABASE,
  ssl: process.env.SEMANTIC_PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

try {
  const files = (await readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  await pool.query('CREATE SCHEMA IF NOT EXISTS semantic_model');
  await pool.query(`CREATE TABLE IF NOT EXISTS semantic_model.schema_migrations (
    version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  for (const file of files) {
    const template = await readFile(path.join(directory, file), 'utf8');
    const graph = process.env.SEMANTIC_AGE_GRAPH || 'semantic_model_graph';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(graph)) throw new Error('SEMANTIC_AGE_GRAPH is not a safe PostgreSQL identifier');
    const sql = template.replaceAll('__SEMANTIC_AGE_GRAPH__', graph);
    const checksum = createHash('sha256').update(template).digest('hex');
    const previous = await pool.query('SELECT checksum FROM semantic_model.schema_migrations WHERE version = $1', [file]);
    if (previous.rowCount) {
      if (previous.rows[0].checksum !== checksum) throw new Error(`Migration checksum changed: ${file}`);
      continue;
    }
    if (file === '002_semantic_age_graph.sql') {
      // AGE extension installation cannot share a transaction with its first LOAD on some server builds.
      await pool.query('CREATE EXTENSION IF NOT EXISTS age');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const statements = sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
      for (const statement of statements) {
        await client.query(statement);
      }
      await client.query('INSERT INTO semantic_model.schema_migrations(version, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      process.stdout.write(`Applied ${file}\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
