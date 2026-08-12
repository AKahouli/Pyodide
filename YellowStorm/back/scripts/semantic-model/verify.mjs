import process from 'node:process';
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.SEMANTIC_PG_HOST,
  port: Number(process.env.SEMANTIC_PG_PORT || 5432),
  user: process.env.SEMANTIC_PG_USER,
  password: process.env.SEMANTIC_PG_PASSWORD,
  database: process.env.SEMANTIC_PG_DATABASE,
  ssl: process.env.SEMANTIC_PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

try {
  const graph = process.env.SEMANTIC_AGE_GRAPH || 'semantic_model_graph';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(graph)) throw new Error('SEMANTIC_AGE_GRAPH is not a safe PostgreSQL identifier');
  const result = await pool.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'semantic_model') AS schema_ready,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'age') AS age_ready,
    EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = $1) AS graph_ready`,
    [graph]);
  const readiness = result.rows[0];
  if (!readiness.schema_ready || !readiness.age_ready || !readiness.graph_ready) {
    throw new Error('Semantic Model database verification failed');
  }
  const client = await pool.connect();
  try {
    await client.query("LOAD 'age'");
    await client.query('SET search_path = ag_catalog, "$user", public');
    await client.query('BEGIN');
    await client.query(
      `SELECT * FROM ag_catalog.cypher('${graph}', $$
        CREATE (node:SemanticNodeType {id: $id, modelId: $modelId, versionId: $versionId, payload: $payload}) RETURN node
      $$, $1::ag_catalog.agtype) AS (node ag_catalog.agtype)`,
      [JSON.stringify({ id: '10000000-0000-4000-8000-000000000001', modelId: '20000000-0000-4000-8000-000000000001', versionId: '30000000-0000-4000-8000-000000000001', payload: '{"verification":true}' })],
    );
    await client.query(
      `SELECT * FROM ag_catalog.cypher('${graph}', $$
        CREATE (node:SemanticNodeType {id: $id, modelId: $modelId, versionId: $versionId, payload: $payload}) RETURN node
      $$, $1::ag_catalog.agtype) AS (node ag_catalog.agtype)`,
      [JSON.stringify({ id: '10000000-0000-4000-8000-000000000002', modelId: '20000000-0000-4000-8000-000000000001', versionId: '30000000-0000-4000-8000-000000000001', payload: '{"verification":true}' })],
    );
    await client.query(
      `SELECT * FROM ag_catalog.cypher('${graph}', $$
        MATCH (source:SemanticNodeType)
        WHERE source.id = $sourceId AND source.versionId = $versionId
        WITH source MATCH (target:SemanticNodeType)
        WHERE target.id = $targetId AND target.versionId = $versionId
        CREATE (source)-[edge:SCHEMA_RELATION {id: $id, modelId: $modelId, versionId: $versionId, payload: $payload}]->(target)
        RETURN edge
      $$, $1::ag_catalog.agtype) AS (edge ag_catalog.agtype)`,
      [JSON.stringify({ sourceId: '10000000-0000-4000-8000-000000000001', targetId: '10000000-0000-4000-8000-000000000002', id: '40000000-0000-4000-8000-000000000001', modelId: '20000000-0000-4000-8000-000000000001', versionId: '30000000-0000-4000-8000-000000000001', payload: '{"label":"Before"}' })],
    );
    await client.query(
      `SELECT * FROM ag_catalog.cypher('${graph}', $$
        MATCH ()-[entity:SCHEMA_RELATION]-()
        WHERE entity.id = $id AND entity.versionId = $versionId SET entity.payload = $payload RETURN entity
      $$, $1::ag_catalog.agtype) AS (entity ag_catalog.agtype)`,
      [JSON.stringify({ id: '40000000-0000-4000-8000-000000000001', versionId: '30000000-0000-4000-8000-000000000001', payload: '{"id":"40000000-0000-4000-8000-000000000001","label":"After","modelId":"20000000-0000-4000-8000-000000000001","versionId":"30000000-0000-4000-8000-000000000001"}' })],
    );
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  process.stdout.write('Semantic Model schema and AGE graph are ready.\n');
} finally {
  await pool.end();
}
