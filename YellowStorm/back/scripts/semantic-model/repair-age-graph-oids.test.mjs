import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRepair, repair, validateInventory } from './repair-age-graph-oids.mjs';

const graph = (name = 'semantic_model_graph', old_id = '96952', new_id = '16415') =>
  ({ name, old_id, new_id, namespace_id: new_id, namespace_name: name });
const columns = Object.entries({
  ag_graph: { graphid: 'oid', name: 'name', namespace: 'regnamespace' },
  ag_label: { name: 'name', graph: 'oid', id: 'ag_catalog.label_id', kind: 'ag_catalog.label_kind', relation: 'regclass', seq_name: 'name' },
}).flatMap(([table_name, fields]) => Object.entries(fields).map(([column_name, type_name]) =>
  ({ schema_name: 'ag_catalog', table_name, column_name, type_name })));

function fake({ failCypher = false, failGraphUpdate = false } = {}) {
  let graphs = [graph()];
  let labels = [{ graph: '96952', name: '_ag_label_vertex', id: 1, kind: 'v', relation: '16420', seq_name: '_ag_label_vertex_id_seq' }];
  let saved;
  const calls = [];
  return {
    calls,
    state: () => ({ graphs, labels }),
    async query(sql, params) {
      calls.push(sql);
      if (sql.startsWith('BEGIN')) saved = structuredClone({ graphs, labels });
      if (sql === 'ROLLBACK') ({ graphs, labels } = saved);
      if (sql.includes('SELECT extversion')) return { rows: [{ extversion: '1.8.0' }] };
      if (sql.includes('format_type')) return { rows: columns };
      if (sql.includes('SELECT g.name')) return { rows: structuredClone(graphs) };
      if (sql.startsWith('SELECT graph::text')) return { rows: structuredClone(labels) };
      if (sql.startsWith('WITH moved AS')) {
        if (failGraphUpdate) throw new Error('injected second update failure');
        for (const label of labels) if (label.graph === String(params[1])) label.graph = String(params[0]);
        graphs[0].old_id = String(params[0]);
        return { rows: [{ graphs: 1, labels: 1 }] };
      }
      if (sql.includes('ag_catalog.cypher') && failCypher) throw new Error('injected Cypher failure');
      return { rows: [] };
    },
  };
}

test('mapping rejects missing/mismatched namespaces, duplicates, orphan labels and target intersections', () => {
  assert.deepEqual(planRepair([graph()], [{ graph: '96952' }]), [{ name: 'semantic_model_graph', old_id: 96952, new_id: 16415 }]);
  for (const graphs of [
    [{ ...graph(), namespace_id: null }], [{ ...graph(), namespace_name: 'wrong' }],
    [graph(), graph('other')], [graph(), graph('other', '999', '16415')],
    [graph(), graph('other', '16415', '20000')],
    [graph('a', '1', '2'), graph('b', '2', '1')],
  ]) assert.throws(() => planRepair(graphs, []));
  assert.throws(() => planRepair([graph()], [{ graph: '100' }]), /Orphan/);
  assert.deepEqual(planRepair([graph('ok', '12', '12')], []), []);
});

test('inventory refuses additional catalogs, columns and changed types', () => {
  validateInventory(columns);
  assert.throws(() => validateInventory([...columns, { table_name: 'other', column_name: 'graph', type_name: 'oid' }]));
  assert.throws(() => validateInventory([...columns, { table_name: 'ag_label', column_name: 'other_graph', type_name: 'oid' }]));
  assert.throws(() => validateInventory(columns.slice(1)));
});

test('default preflight is read-only and never updates or runs Cypher', async () => {
  const client = fake();
  const reports = [];
  const result = await repair(client, { report: (report) => reports.push(report) });
  assert.equal(result.applied, false);
  assert.match(client.calls[0], /READ ONLY/);
  assert.equal(client.calls.at(-1), 'ROLLBACK');
  assert.ok(!client.calls.some((sql) => /UPDATE|cypher|COMMIT/.test(sql)));
  assert.deepEqual(reports[0].rollback, [{ name: 'semantic_model_graph', old_id: 16415, new_id: 96952 }]);
});

test('apply locks both catalogs, changes only two references and checks vertices and edges before commit', async () => {
  const client = fake();
  let reported = false;
  await repair(client, { apply: true, report: () => { reported = true; assert.ok(!client.calls.some((sql) => sql.includes('UPDATE'))); } });
  assert.ok(reported);
  assert.ok(client.calls.some((sql) => /ag_graph, ag_catalog.ag_label IN ACCESS EXCLUSIVE/.test(sql)));
  assert.equal(client.calls.filter((sql) => sql.startsWith('WITH moved AS')).length, 1);
  assert.equal(client.calls.filter((sql) => sql.includes('UPDATE ag_catalog.ag_graph') && sql.includes('UPDATE ag_catalog.ag_label')).length, 1);
  assert.equal(client.calls.filter((sql) => sql.includes('ag_catalog.cypher')).length, 2);
  assert.equal(client.calls.at(-1), 'COMMIT');
  assert.equal(client.state().graphs[0].old_id, '16415');
  assert.equal(client.state().labels[0].graph, '16415');
  assert.equal(client.state().labels[0].relation, '16420');
});

test('validation checks repaired Cypher then rolls back the catalog changes', async () => {
  const client = fake();
  const before = structuredClone(client.state());
  const result = await repair(client, { apply: true, validateOnly: true });
  assert.equal(result.validated, true);
  assert.equal(result.applied, false);
  assert.equal(client.calls.filter((sql) => sql.includes('ag_catalog.cypher')).length, 2);
  assert.equal(client.calls.at(-1), 'ROLLBACK');
  assert.ok(!client.calls.includes('COMMIT'));
  assert.deepEqual(client.state(), before);
});

for (const failure of ['failCypher', 'failGraphUpdate']) {
  test(`${failure} rolls back both catalog updates`, async () => {
    const client = fake({ [failure]: true });
    const before = structuredClone(client.state());
    await assert.rejects(repair(client, { apply: true }), /injected/);
    assert.equal(client.calls.at(-1), 'ROLLBACK');
    assert.ok(!client.calls.includes('COMMIT'));
    assert.deepEqual(client.state(), before);
  });
}
