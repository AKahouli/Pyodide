import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Deliberately support only this catalog layout; unknown AGE versions fail closed.
const expected = {
  ag_graph: { graphid: 'oid', name: 'name', namespace: 'regnamespace' },
  ag_label: { name: 'name', graph: 'oid', id: 'ag_catalog.label_id', kind: 'ag_catalog.label_kind', relation: 'regclass', seq_name: 'name' },
};

export function validateInventory(columns) {
  const actual = {};
  for (const { table_name, column_name, type_name } of columns) {
    (actual[table_name] ??= {})[column_name] = type_name;
  }
  const canonical = (value) => JSON.stringify(Object.entries(value).sort().map(([table, fields]) =>
    [table, Object.entries(fields).sort()]));
  if (canonical(actual) !== canonical(expected)) throw new Error('Unsupported AGE catalog layout; review all OID references before repair');
}

export function planRepair(graphs, labels) {
  const oldIds = new Set();
  const newIds = new Set();
  const names = new Set();
  const oid = (value) => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 4294967295;
  for (const graph of graphs) {
    if (!oid(graph.old_id) || !oid(graph.new_id) || graph.name !== graph.namespace_name ||
        Number(graph.namespace_id) !== Number(graph.new_id) || names.has(graph.name) ||
        oldIds.has(Number(graph.old_id)) || newIds.has(Number(graph.new_id))) {
      throw new Error('Missing/mismatched namespace or ambiguous graph mapping');
    }
    oldIds.add(Number(graph.old_id));
    newIds.add(Number(graph.new_id));
    names.add(graph.name);
  }
  if (labels.some((label) => !oldIds.has(Number(label.graph)))) throw new Error('Orphan label; refusing repair');
  const mapping = graphs.filter((graph) => Number(graph.old_id) !== Number(graph.new_id));
  if (mapping.some((graph) => oldIds.has(Number(graph.new_id)))) throw new Error('Target OID intersects existing graph IDs; refusing repair');
  return mapping.map(({ name, old_id, new_id }) => ({ name, old_id: Number(old_id), new_id: Number(new_id) }));
}

async function snapshot(client) {
  const graphs = (await client.query(`SELECT g.name::text, g.graphid::text AS old_id,
    g.namespace::oid::text AS new_id, n.oid::text AS namespace_id, n.nspname::text AS namespace_name
    FROM ag_catalog.ag_graph g LEFT JOIN pg_catalog.pg_namespace n ON n.oid = g.namespace::oid
    ORDER BY g.name`)).rows;
  const labels = (await client.query('SELECT graph::text, name::text, id, kind, relation::oid::text AS relation, seq_name::text FROM ag_catalog.ag_label ORDER BY graph, id')).rows;
  return { graphs, labels };
}

export async function repair(client, { apply = false, validateOnly = false, report = () => {} } = {}) {
  if (validateOnly && !apply) throw new Error('Validation requires the repair transaction');
  let begun = false;
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    begun = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query(`LOCK TABLE ag_catalog.ag_graph, ag_catalog.ag_label IN ${apply ? 'ACCESS EXCLUSIVE' : 'ACCESS SHARE'} MODE`);
    const version = (await client.query("SELECT extversion FROM pg_catalog.pg_extension WHERE extname = 'age'")).rows;
    if (version.length !== 1 || version[0].extversion !== '1.8.0') throw new Error('Repair requires reviewed AGE 1.8.0');
    const inventory = (await client.query(`SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS type_name
      FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_depend d ON d.refclassid = 'pg_catalog.pg_extension'::regclass
        AND d.refobjid = e.oid AND d.deptype = 'e' AND d.classid = 'pg_catalog.pg_class'::regclass
      JOIN pg_catalog.pg_class c ON c.oid = d.objid AND c.relkind IN ('r', 'p')
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE e.extname = 'age' ORDER BY c.relname, a.attnum`)).rows;
    if (inventory.some((column) => column.schema_name !== 'ag_catalog')) throw new Error('Unexpected AGE catalog schema');
    validateInventory(inventory);
    const before = await snapshot(client);
    const mapping = planRepair(before.graphs, before.labels);
    // Emit before the first write so an operator can retain a non-secret reverse map.
    report({ mode: apply ? 'apply-pending' : 'preflight', mapping,
      rollback: mapping.map(({ name, old_id, new_id }) => ({ name, old_id: new_id, new_id: old_id })) });
    if (!apply) {
      await client.query('ROLLBACK');
      begun = false;
      return { applied: false, mapping };
    }
    for (const { old_id, new_id } of mapping) {
      // One statement keeps the installed immediate graph FK valid without
      // disabling triggers, dropping constraints or leaving either side orphaned.
      const changed = await client.query(`WITH moved AS (
        UPDATE ag_catalog.ag_graph SET graphid = $1::oid WHERE graphid = $2::oid RETURNING graphid
      ), labels AS (
        UPDATE ag_catalog.ag_label SET graph = $1::oid WHERE graph = $2::oid
          AND EXISTS (SELECT 1 FROM moved) RETURNING graph
      ) SELECT (SELECT count(*)::int FROM moved) AS graphs, (SELECT count(*)::int FROM labels) AS labels`, [new_id, old_id]);
      const expectedLabels = before.labels.filter((label) => Number(label.graph) === old_id).length;
      if (changed.rows[0]?.labels !== expectedLabels) throw new Error('Label update count mismatch');
      if (changed.rows[0]?.graphs !== 1) throw new Error('Graph update count mismatch');
    }
    const after = await snapshot(client);
    if (planRepair(after.graphs, after.labels).length || after.graphs.length !== before.graphs.length) throw new Error('Graph postcondition failed');
    const remap = new Map(mapping.map(({ old_id, new_id }) => [old_id, new_id]));
    const normalized = (labels) => labels.map((label) => JSON.stringify(label)).sort();
    const expectedLabels = before.labels.map((label) => ({ ...label, graph: String(remap.get(Number(label.graph)) ?? label.graph) }));
    if (JSON.stringify(normalized(after.labels)) !== JSON.stringify(normalized(expectedLabels))) throw new Error('Label metadata postcondition failed');
    // No AGE function runs before the repair: avoid warming stale per-backend caches.
    await client.query("LOAD 'age'");
    await client.query('SET LOCAL search_path = ag_catalog, pg_catalog');
    await client.query('SET LOCAL standard_conforming_strings = on');
    for (const { name } of after.graphs) {
      const literal = "'" + name.replaceAll("'", "''") + "'";
      await client.query(`SELECT * FROM ag_catalog.cypher(${literal}, $$ MATCH (n) RETURN n LIMIT 1 $$) AS (node ag_catalog.agtype)`);
      await client.query(`SELECT * FROM ag_catalog.cypher(${literal}, $$ MATCH ()-[e]->() RETURN e LIMIT 1 $$) AS (edge ag_catalog.agtype)`);
    }
    await client.query(validateOnly ? 'ROLLBACK' : 'COMMIT');
    begun = false;
    return { applied: !validateOnly, validated: true, mapping };
  } catch (error) {
    if (begun) await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--apply', '--validate'].includes(arg)) || args.length > 1) throw new Error('Usage: node repair-age-graph-oids.mjs [--apply | --validate]');
  await import('dotenv/config');
  const { default: pg } = await import('pg');
  const setting = (key) => process.env[`SEMANTIC_AGEGRAPH_${key}`] || process.env[`SEMANTIC_PG_${key}`];
  for (const key of ['HOST', 'USER', 'DATABASE']) {
    if (!setting(key)) throw new Error(`Missing AGE connection ${key}`);
  }
  const client = new pg.Client({
    host: setting('HOST'),
    port: Number(setting('PORT') || 5432),
    user: setting('USER'),
    password: setting('PASSWORD'),
    database: setting('DATABASE'),
    ssl: setting('SSL') === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    const result = await repair(client, { apply: args.length === 1, validateOnly: args.includes('--validate'), report: (value) => console.log(JSON.stringify(value)) });
    console.log(JSON.stringify(result));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Driver errors may contain connection details; do not print them.
    console.error('AGE repair failed; transaction was not confirmed committed. Check database state with a fresh preflight; do not retry apply blindly.');
    process.exitCode = 1;
  });
}
