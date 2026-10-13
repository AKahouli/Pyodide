import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { probeStartup, verifyObservation, canonical, healthLine, captureFailure } from '../runtime/lib/startup-health.mjs';

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

const readConfig = () => ({ apiUrl: 'http://hindsight.invalid/', apiToken: 'synthetic-test-token', retainSessions: true });
const request = async () => ({ ok: true, status: 200, json: async () => ({ status: 'healthy', database: 'connected' }) });
const client = { mcp: { status: async () => ({ data: { 'code-review-graph': { status: 'connected' } } }) } };
const probe = overrides => probeStartup({ root, client, readConfig, request, ...overrides });
const graph = overrides => verifyObservation({ root, tool: 'code-review-graph_list_graph_stats_tool', args: { repo_root: root }, output: JSON.stringify({ status: 'ok', total_nodes: 12, total_edges: 9 }), readConfig, request, ...overrides });
const diagnoseOutput = () => ({ workspace: root, bank_id: 'synthetic-bank', config: { api_url: 'http://hindsight.invalid/', disabled: false }, credential: { api_token_matches_config: true } });
const hindsight = overrides => verifyObservation({ root, tool: 'hindsight_diagnose', args: {}, output: diagnoseOutput(), readConfig, request, ...overrides });

test('connected MCP and healthy API remain pending until real scoped tool observations', async () => {
  let observedRoot;
  const report = await probe({ client: { mcp: { status: async (input, options) => {
    observedRoot = input.query.directory;
    assert.ok(options.signal);
    return { data: { 'code-review-graph': { status: 'connected' } } };
  } } } });
  assert.equal(observedRoot, root);
  assert.equal(report.graph.status, 'PENDING');
  assert.equal(report.hindsight.status, 'PENDING');
  assert.equal(report.checkpoints.status, 'PENDING');
  assert.match(healthLine(report), /graph PENDING; Hindsight PENDING; checkpoints PENDING/);
});

test('disconnected, missing, errored and timed-out MCP status fails visibly', async () => {
  for (const status of [
    async () => ({ data: { 'code-review-graph': { status: 'disconnected' } } }),
    async () => ({ data: {} }),
    async () => ({ error: { message: 'synthetic' } }),
    async () => { throw new DOMException('Timed out', 'TimeoutError'); },
  ]) {
    const report = await probe({ client: { mcp: { status } } });
    assert.equal(report.graph.status, 'FAIL');
    assert.ok(report.graph.action);
  }
});

test('checkpoint initialization error or missing marker is reported without hiding other probes', async () => {
  for (const checkpointError of ['Missing current-root policy marker', 'SQLite store failed']) {
    const report = await probe({ checkpointError });
    assert.equal(report.checkpoints.status, 'FAIL');
    assert.equal(report.graph.status, 'PENDING');
    assert.match(healthLine(report), /checkpoints FAIL/);
  }
});

test('Hindsight rejects HTTP auth/errors, network timeout and unhealthy database', async () => {
  for (const fetcher of [
    async () => ({ ok: false, status: 401 }),
    async () => ({ ok: false, status: 503 }),
    async () => { throw new DOMException('Timed out', 'TimeoutError'); },
    async () => ({ ok: true, json: async () => ({ status: 'healthy', database: 'disconnected' }) }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid response'); } }),
  ]) assert.equal((await probe({ request: fetcher })).hindsight.status, 'FAIL');
});

test('corrupt, disabled, capture-disabled and malformed-endpoint configuration fails', async () => {
  for (const reader of [
    () => { throw new SyntaxError('corrupt JSON'); },
    () => ({ ...readConfig(), disabled: true }),
    () => ({ ...readConfig(), retainSessions: false }),
    () => ({ apiUrl: 'not-a-valid-url' }),
  ]) assert.equal((await probe({ readConfig: reader })).hindsight.status, 'FAIL');
});

test('graph rejects missing or different root and tool error responses', async () => {
  for (const overrides of [
    { args: {} },
    { args: { repo_root: otherRoot } },
    { output: { error: 'synthetic' } },
    { output: { isError: true } },
    { output: { status: 'error' } },
    { output: 'invalid JSON' },
  ]) assert.equal((await graph(overrides)).value.status, 'FAIL');
});

test('graph rejects empty or missing index and passes usable scoped statistics', async () => {
  for (const output of [
    { status: 'ok', total_nodes: 0 }, { status: 'ok', node_count: 0 }, { status: 'not_initialized' },
    { status: 'ok', message: 'graph not found' }, { status: 'ok' }, {}, null,
  ]) assert.equal((await graph({ output })).value.status, 'FAIL', JSON.stringify(output));
  const result = await graph();
  assert.equal(result.key, 'graph');
  assert.equal(result.value.status, 'PASS');
  assert.equal(result.value.root, root);
});

test('Hindsight diagnose rejects wrong workspace, disabled plugin and rejected credential', async () => {
  for (const output of [
    { ...diagnoseOutput(), workspace: otherRoot },
    { ...diagnoseOutput(), workspace: undefined },
    { ...diagnoseOutput(), config: { ...diagnoseOutput().config, disabled: true } },
    { ...diagnoseOutput(), credential: { api_token_matches_config: false } },
    { ...diagnoseOutput(), bank_id: undefined },
    { error: 'synthetic' },
  ]) assert.equal((await hindsight({ output })).value.status, 'FAIL');
});

test('bank read rejection fails even when diagnose itself succeeds', async () => {
  for (const status of [401, 403, 404, 503]) {
    const result = await hindsight({ request: async () => ({ ok: false, status }) });
    assert.equal(result.value.status, 'FAIL');
    assert.ok(result.value.action);
  }
});

test('successful diagnose authenticates the actual bank before reporting PASS', async () => {
  let requested, options;
  const output = { ...diagnoseOutput(), bank_id: 'bank/with space' };
  const result = await hindsight({ output, request: async (url, opts) => {
    requested = String(url); options = opts;
    return { ok: true, json: async () => ({ total_memories: 3 }) };
  } });
  assert.equal(requested, 'http://hindsight.invalid/v1/default/banks/bank%2Fwith%20space/stats');
  assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token');
  assert.ok(options.signal);
  assert.equal(result.value.status, 'PASS');
  assert.equal(result.value.bank, output.bank_id);
});

test('diagnose cannot promote disabled or capture-disabled local configuration to PASS', async () => {
  for (const cfg of [{ ...readConfig(), disabled: true }, { ...readConfig(), retainSessions: false }, { ...readConfig(), banks: { 'synthetic-bank': { retainSessions: false } } }]) {
    assert.equal((await hindsight({ readConfig: () => cfg })).value.status, 'FAIL');
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
  assert.equal(await verifyObservation({ root, tool: 'unrelated_tool', output: {} }), null);
});

test('effective harness and current-directory capture overrides are honored', async () => {
  for (const cfg of [
    { ...readConfig(), harnesses: { opencode: { retainSessions: false } } },
    { ...readConfig(), harnesses: { opencode: { disabled: true } } },
    { ...readConfig(), paths: { [root]: { retainSessions: false } } },
    { ...readConfig(), paths: { [root]: { disabled: true } } },
    { ...readConfig(), paths: { [directory]: { retainSessions: false } } },
  ]) {
    assert.equal((await probe({ readConfig: () => cfg })).hindsight.status, 'FAIL');
    assert.equal((await hindsight({ readConfig: () => cfg })).value.status, 'FAIL');
  }
  const cfg = { ...readConfig(), paths: { [otherRoot]: { retainSessions: false } } };
  assert.equal((await probe({ readConfig: () => cfg })).hindsight.status, 'PENDING');
  assert.equal((await hindsight({ readConfig: () => cfg })).value.status, 'PASS');
});

test('diagnose hooks disabled and HTTP-success bank error payload cannot report PASS', async () => {
  assert.equal((await hindsight({ output: { ...diagnoseOutput(), environment: { hooks_disabled: true } } })).value.status, 'FAIL');
  for (const body of [{ error: 'synthetic rejection' }, { isError: true }]) {
    assert.equal((await hindsight({ request: async () => ({ ok: true, status: 200, json: async () => body }) })).value.status, 'FAIL');
  }
});

test('capture diagnostics are session scoped, time scoped, and recover after successful retain', () => {
  const filename = path.join(directory, 'capture-scoped.jsonl');
  const since = '2026-10-13T10:00:00.000Z';
  const write = item => appendFileSync(filename, `${JSON.stringify(item)}\n`);
  writeFileSync(filename, '{malformed}\n');
  write({ session: 'own', ts: '2026-10-13T09:00:00.000Z', event: 'retain_failed' });
  write({ session: 'other', ts: since, event: 'retain_failed' });
  write({ bank_id: 'shared', ts: since, event: 'retain_failed' });
  assert.equal(captureFailure('own', since, filename), null);
  for (const event of ['retain_failed', 'idle_fetch_failed']) {
    write({ session: 'own', ts: since, event });
    const failure = captureFailure('own', since, filename);
    assert.equal(failure.status, 'FAIL');
    assert.ok(failure.action);
    assert.equal(captureFailure('unrelated', since, filename), null);
    write({ session: 'own', ts: since, event: 'retain_ok' });
    assert.equal(captureFailure('own', since, filename), null);
  }
  write({ session: 'other', ts: since, event: 'idle_fetch_failed' });
  assert.equal(captureFailure('own', since, filename), null);
});

test('capture diagnostics only read the bounded tail and never expose raw errors', () => {
  const filename = path.join(directory, 'capture-bounded.jsonl');
  const since = '2026-10-13T10:00:00.000Z';
  writeFileSync(filename, `${JSON.stringify({ session: 'own', ts: since, event: 'retain_failed' })}\n`);
  appendFileSync(filename, `${'x'.repeat(70000)}\n`);
  assert.equal(captureFailure('own', since, filename), null);
  appendFileSync(filename, `${JSON.stringify({ session: 'own', ts: since, event: 'retain_failed', error: 'private diagnostic payload' })}\n`);
  const failure = captureFailure('own', since, filename);
  assert.equal(failure.status, 'FAIL');
  assert.doesNotMatch(JSON.stringify(failure), /private diagnostic payload/);
  assert.equal(captureFailure('own', since, path.join(directory, 'absent.jsonl')), null);
});

test('native MCP and custom-tool envelopes preserve verified evidence and errors', async () => {
  const stats = { status: 'ok', total_nodes: 2 };
  for (const output of [
    { content: [{ type: 'text', text: JSON.stringify(stats) }] },
    { structuredContent: stats },
  ]) assert.equal((await graph({ output })).value.status, 'PASS');
  assert.equal((await graph({ output: { isError: true, structuredContent: stats } })).value.status, 'FAIL');
  assert.equal((await hindsight({ output: { output: JSON.stringify(diagnoseOutput()) } })).value.status, 'PASS');
  assert.equal(await graph({ tool: 'code-review-graph_get_minimal_context_tool', output: { status: 'ok' } }), null);
});
