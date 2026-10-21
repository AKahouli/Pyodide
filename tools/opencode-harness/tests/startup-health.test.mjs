import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { probeStartup, probeGraphifyIndex, canonical, healthLine } from '../runtime/lib/startup-health.mjs';

let directory, root, otherRoot;
before(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'opencode-startup-health-'));
  root = path.join(directory, 'first'); otherRoot = path.join(directory, 'second');
  mkdirSync(root); mkdirSync(otherRoot);
});
after(() => {
  assert.equal(path.dirname(directory), tmpdir());
  rmSync(directory, { recursive: true, force: true });
});

const graphPayload = (indexRoot, schema = 1) => JSON.stringify({ directed: false, multigraph: false, graph: { schema_version: schema, graphify_version: '0.9.92' }, nodes: [{ id: 'a', label: 'A', source_file: 'src/a.js' }], links: [] });
const writeGraph = (base, indexRoot = base, payload = graphPayload(indexRoot)) => {
  mkdirSync(path.join(base, 'graphify-out'), { recursive: true });
  writeFileSync(path.join(base, 'graphify-out/graph.json'), payload);
  writeFileSync(path.join(base, 'graphify-out/.graphify_root'), indexRoot);
};
const probe = overrides => probeStartup({ root, readGraph: async () => ({ indexRoot: root, hasNodes: true, schemaVersion: 1 }), ...overrides });

test('nonempty current-root graphify index passes without model tools', async () => {
  const report = await probe();
  assert.equal(report.graph.status, 'PASS');
  assert.equal(report.checkpoints.status, 'PENDING');
  assert.match(healthLine(report), /graph PASS; checkpoints PENDING/);
  assert.equal(Object.keys(report).filter(key => !['root', 'checkedAt', 'harnessVersion'].includes(key)).length, 2, 'only graph and checkpoints are probed');
});

test('checkpoint initialization error or missing marker is reported without hiding other probes', async () => {
  for (const checkpointError of ['Missing current-root policy marker', 'SQLite store failed']) {
    const report = await probe({ checkpointError });
    assert.equal(report.checkpoints.status, 'FAIL');
    assert.equal(report.graph.status, 'PASS');
    assert.match(healthLine(report), /checkpoints FAIL/);
  }
});

test('canonical roots and concurrent reports remain distinct', async () => {
  assert.notEqual(canonical(root), canonical(otherRoot));
  assert.equal(canonical(path.join(root, '.')), canonical(root));
  const reports = await Promise.all([probe(), probe({ root: otherRoot, checkpointError: 'synthetic' })]);
  assert.equal(reports[0].root, root);
  assert.equal(reports[1].root, otherRoot);
  assert.equal(reports[0].checkpoints.status, 'PENDING');
  assert.equal(reports[1].checkpoints.status, 'FAIL');
});

test('automatic probes reject wrong/missing graph identity and empty/corrupt index', async () => {
  for (const graph of [{ indexRoot: otherRoot, hasNodes: true, schemaVersion: 1 }, { hasNodes: true, schemaVersion: 1 }, { indexRoot: root, hasNodes: false, schemaVersion: 1 }, { indexRoot: root, hasNodes: true }]) {
    assert.equal((await probe({ readGraph: async () => graph })).graph.status, 'FAIL');
  }
  assert.equal((await probe({ readGraph: async () => { throw new Error('private index detail'); } })).graph.status, 'FAIL');
  assert.ok((await probe({ readGraph: async () => { throw new Error('private index detail'); } })).graph.reason.length < 200, 'raw errors are not exposed');
});

test('read-only graphify index probe checks root marker, schema and nodes without writing', async () => {
  writeGraph(root);
  const probeResult = await probeGraphifyIndex(root);
  assert.equal(probeResult.indexRoot, root);
  assert.equal(probeResult.schemaVersion, 1);
  assert.equal(probeResult.graphifyVersion, '0.9.92');
  assert.equal(probeResult.hasNodes, true);
  await assert.rejects(probeGraphifyIndex(otherRoot), /ENOENT|no such/i);
});

test('index probe rejects missing nodes, empty nodes and unknown schema', async () => {
  writeGraph(root, root, '{"directed":false,"multigraph":false,"graph":{"schema_version":1},"links":[]}');
  await assert.rejects(probeGraphifyIndex(root), /nodes/);
  writeGraph(root, root, '{"directed":false,"multigraph":false,"graph":{"schema_version":1},"nodes":[],"links":[]}');
  await assert.rejects(probeGraphifyIndex(root), /index/);
  writeGraph(root, root, '{"directed":false,"multigraph":false,"graph":{"corpus":"x"},"nodes":[{"id":"a"}],"links":[]}');
  await assert.rejects(probeGraphifyIndex(root), /schema/);
  writeGraph(root, root, '{"directed":false,"graph":{"schema_version":1},"nodes":');
  await assert.rejects(probeGraphifyIndex(root), /index/);
});

test('index probe verifies nodes near the head of a large corpus without loading it fully', async () => {
  const filler = 'x'.repeat(600000);
  writeGraph(root, root, `{"directed":false,"multigraph":false,"graph":{"schema_version":2,"graphify_version":"0.9.92"},"nodes":[{"id":"${filler}","label":"Big"}],"links":[]}`);
  const probeResult = await probeGraphifyIndex(root);
  assert.equal(probeResult.schemaVersion, 2);
  assert.equal(probeResult.hasNodes, true);
});

test('probe failure action explains availability and freshness ownership', async () => {
  const report = await probe({ readGraph: async () => { throw new Error('root'); } });
  assert.equal(report.graph.status, 'FAIL');
  assert.match(report.graph.action, /graphify update|graphify extract/);
});
