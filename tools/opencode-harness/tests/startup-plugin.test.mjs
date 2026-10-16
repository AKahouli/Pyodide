import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './fixture.mjs';

let sandbox, SdlcHarness, oldFetch, oldConfig;
before(async () => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'opencode-startup-plugin-'));
  for (const dir of ['plugins', 'lib']) mkdirSync(path.join(sandbox, dir));
  writeFileSync(path.join(sandbox, 'package.json'), '{"type":"module"}');
  const runtime = new URL('../runtime/', import.meta.url);
  copyFileSync(new URL('plugins/sdlc.js', runtime), path.join(sandbox, 'plugins/sdlc.js'));
  for (const file of readdirSync(new URL('lib/', runtime))) copyFileSync(new URL(`lib/${file}`, runtime), path.join(sandbox, 'lib', file));
  symlinkSync(path.join(homedir(), '.config/opencode/node_modules'), path.join(sandbox, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  oldFetch = globalThis.fetch; oldConfig = process.env.HINDSIGHT_CONFIG;
  process.env.HINDSIGHT_CONFIG = path.join(sandbox, 'memory.json');
  writeFileSync(process.env.HINDSIGHT_CONFIG, JSON.stringify({ apiUrl: 'http://memory.invalid', retainSessions: true, optInOnly: false }));
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: 'healthy', database: 'connected', total_memories: 1 }) });
  ({ SdlcHarness } = await import(pathToFileURL(path.join(sandbox, 'plugins/sdlc.js'))));
});
after(() => {
  globalThis.fetch = oldFetch;
  if (oldConfig === undefined) delete process.env.HINDSIGHT_CONFIG; else process.env.HINDSIGHT_CONFIG = oldConfig;
  unlinkSync(path.join(sandbox, 'node_modules'));
  assert.equal(path.dirname(sandbox), tmpdir());
  rmSync(sandbox, { recursive: true, force: true });
});

async function create(t, status = async () => ({ data: { 'code-review-graph': { status: 'connected' } } }), options = {}) {
  const repo = fixture();
  mkdirSync(path.join(repo.root, '.code-review-graph'));
  const graph = new DatabaseSync(path.join(repo.root, '.code-review-graph/graph.db'));
  graph.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE nodes(file_path TEXT);');
  graph.prepare('INSERT INTO metadata VALUES (?,?)').run('repo_root', repo.root);
  graph.prepare('INSERT INTO nodes VALUES (?)').run(path.join(repo.root, 'src/a.js'));
  graph.close();
  const toasts = [];
  const directory = path.join(repo.root, options.directory || '');
  mkdirSync(directory, { recursive: true });
  options.configure?.(repo.root, directory);
  const client = { mcp: { status }, tool: { ids: options.ids || (async () => ({ data: ['hindsight_diagnose'] })) }, tui: { showToast: async input => { toasts.push(input.body); } } };
  const plugin = await SdlcHarness({ worktree: repo.root, directory, client });
  t.after(async () => { await plugin.dispose?.(); repo.cleanup(); });
  return { plugin, root: repo.root, directory, toasts };
}
const health = async (plugin, sid, refresh = false) => JSON.parse(await plugin.tool.sdlc_health.execute({ refresh }, { sessionID: sid }));
function assertPass(report) {
  for (const key of ['graph', 'hindsight', 'checkpoints']) assert.equal(report[key].status, 'PASS', `${key}: ${report[key].reason}`);
}
async function prepareEdit(plugin, root, sid) {
  return plugin.tool.sdlc_checkpoint.execute({ goal: 'Test advisory checkpoints', acceptance: ['Normal edits remain available'], nextAction: 'Continue' }, { sessionID: sid });
}
async function observation(plugin, root, sid, tool, callID, status = 'completed') {
  const args = tool === 'hindsight_diagnose' ? {} : { repo_root: root };
  await plugin['tool.execute.before']({ sessionID: sid, tool, callID }, { args });
  const output = tool === 'hindsight_diagnose'
    ? { workspace: root, bank_id: `coding-agent::${path.basename(root)}`, config: { api_url: 'http://memory.invalid', disabled: false }, credential: { api_token_matches_config: true } }
    : { status: 'ok', total_nodes: 5 };
  // Raw MCP after-hook payloads are not authoritative persisted observations.
  await plugin['tool.execute.after']?.({ sessionID: sid, tool, callID }, { content: [{ type: 'text', text: 'unparseable transport wrapper' }] });
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: sid, callID, tool, state: { status, input: args, output: JSON.stringify(output), error: status === 'error' ? 'Synthetic integration failure' : undefined } } } } });
}

test('maintainer calls work when background is missing, false or supported', async t => {
  const { plugin, root } = await create(t);
  const call = args => plugin['tool.execute.before']({ sessionID: 'background', tool: 'task', callID: 'task' }, { args });
  for (const args of [
    { subagent_type: 'maintainer' },
    { subagent_type: 'maintainer', background: false },
    { subagent_type: 'maintainer', task_id: 'existing-child', background: false },
  ]) await call(args);
  for (const args of [
    { subagent_type: 'maintainer', background: true },
    { subagent_type: 'maintainer', task_id: 'existing-child', background: true },
    { subagent_type: 'explore', background: false },
    { subagent_type: 'worker', background: true },
  ]) await call(args);
  await prepareEdit(plugin, root, 'background');
  await plugin['tool.execute.before']({ sessionID: 'background', tool: 'edit', callID: 'source-edit' }, { args: { filePath: 'src/a.js' } });
  writeFileSync(path.join(root, 'src/a.js'), 'export const value = 42;');
  await plugin['tool.execute.after']?.({ sessionID: 'background', tool: 'edit', callID: 'source-edit' }, { output: 'edited' });
});

test('automatic checks create independent receipts and allow prepared edits without diagnostic model calls', async t => {
  const { plugin, root } = await create(t);
  const first = await health(plugin, 'first');
  const second = await health(plugin, 'second');
  assertPass(first); assertPass(second);
  assert.equal(first.sessionID, 'first'); assert.equal(second.sessionID, 'second');
  assert.notEqual(first.probe, second.probe);
  await prepareEdit(plugin, root, 'first');
});

test('concurrent sessions share pending process probes but retain their own cached receipts', async t => {
  let calls = 0, resolveStatus, entered;
  const pending = new Promise(resolve => { entered = resolve; });
  const { plugin } = await create(t, async () => { calls++; entered(); return new Promise(resolve => { resolveStatus = resolve; }); });
  const first = health(plugin, 'parallel-first');
  await pending;
  const second = health(plugin, 'parallel-second');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveStatus({ data: { 'code-review-graph': { status: 'connected' } } });
  const reports = await Promise.all([first, second]);
  reports.forEach(assertPass);
  assert.notEqual(reports[0].probe, reports[1].probe);
  assert.deepEqual(await health(plugin, 'parallel-first'), reports[0]);
  assert.equal(calls, 1);
});

test('native shell permissions remain authoritative during graph failures', async t => {
  const { plugin } = await create(t, async () => ({ data: { 'code-review-graph': { status: 'disconnected' } } }));
  assert.equal((await health(plugin, 'diagnose')).graph.status, 'FAIL');
  for (const command of ['powershell.exe -NoProfile -File scripts/start-local.ps1', 'pwsh -File ./scripts/start-local.ps1', 'Get-Content logs/worker.log -Tail 80', 'npm run build', 'git status --short']) {
    const output = { args: { command } };
    await plugin['tool.execute.before']({ sessionID: 'diagnose', tool: 'bash', callID: command }, output);
    assert.equal(output.args.command, command);
  }
  await plugin['tool.execute.before']({ sessionID: 'diagnose', tool: 'edit', callID: 'edit' }, { args: { filePath: 'src/a.js' } });
});

test('graph and memory failures allow overlapping coding without checkpoint preparation', async t => {
  const { plugin, root, toasts } = await create(t, async () => ({ data: { 'code-review-graph': { status: 'disconnected' } } }), { ids: async () => ({ data: [] }) });
  const receipt = await health(plugin, 'coding');
  assert.equal(receipt.graph.status, 'FAIL'); assert.equal(receipt.hindsight.status, 'FAIL');
  assert.equal(receipt.checkpoints.status, 'PASS');
  assert.equal(toasts.at(-1).variant, 'warning');
  const context = { system: [] };
  await plugin['experimental.chat.system.transform']({ sessionID: 'coding' }, context);
  assert.match(context.system[0], /advisory: continue coding/);
  assert.doesNotMatch(context.system.join(' '), /edits blocked|require.*all.*PASS/i);
  await prepareEdit(plugin, root, 'coding');
  await prepareEdit(plugin, root, 'parallel');
  for (const [tool, args] of [['edit', { filePath: 'src/a.js' }], ['write', { filePath: 'src/a.js' }], ['apply_patch', { patchText: '*** Update File: src/a.js' }]]) {
    await plugin['tool.execute.before']({ sessionID: 'coding', tool, callID: tool }, { args });
    writeFileSync(path.join(root, 'src/a.js'), `export const value = '${tool}';\n`);
    await plugin['tool.execute.after']?.({ sessionID: 'coding', tool, callID: tool }, {});
  }
  assert.match(readFileSync(path.join(root, 'src/a.js'), 'utf8'), /apply_patch/);
  assert.equal((await health(plugin, 'coding')).graph.status, 'FAIL');
  await plugin['tool.execute.before']({ sessionID: 'parallel', tool: 'edit', callID: 'overlap' }, { args: { filePath: 'src/a.js' } });
});

test('missing policy reports failure and allows native edits without replacing shell permissions', async t => {
  const { root, toasts } = await create(t);
  rmSync(path.join(root, 'tools/opencode-harness/policy.json'));
  const fallback = await SdlcHarness({ worktree: root, directory: root, client: { mcp: { status: async () => ({ data: { 'code-review-graph': { status: 'connected' } } }) }, tool: { ids: async () => ({ data: ['hindsight_diagnose'] }) }, tui: { showToast: async input => { toasts.push(input.body); } } } });
  const report = await health(fallback, 'missing-policy');
  assert.equal(report.checkpoints.status, 'FAIL');
  await fallback['tool.execute.before']({ sessionID: 'missing-policy', tool: 'task', callID: 'maintainer' }, { args: { subagent_type: 'maintainer' } });
  await fallback['tool.execute.before']({ sessionID: 'missing-policy', tool: 'task', callID: 'maintainer-background' }, { args: { subagent_type: 'maintainer', background: true } });
  assert.ok(toasts.some(item => item.message.includes('checkpoints FAIL')));
  for (const command of ['git status', 'powershell.exe -NoProfile -File scripts/start-local.ps1', 'Get-Content logs/worker.log -Tail 80']) {
    await fallback['tool.execute.before']({ sessionID: 'missing-policy', tool: 'bash', callID: command }, { args: { command } });
  }
  for (const [tool, args] of [['edit', { filePath: 'src/a.js' }], ['write', { filePath: 'src/a.js' }]]) {
    await fallback['tool.execute.before']({ sessionID: 'missing-policy', tool, callID: tool }, { args });
  }
});

test('refresh supersedes delayed startup failure and stale integration tool errors', async t => {
  let resolveOld, entered;
  const oldEntered = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  const { plugin } = await create(t, async () => {
    calls++;
    if (calls === 1) { entered(); return new Promise(resolve => { resolveOld = resolve; }); }
    return { data: { 'code-review-graph': { status: 'connected' } } };
  });
  const old = health(plugin, 'race');
  await oldEntered;
  assertPass(await health(plugin, 'race', true));
  resolveOld({ data: { 'code-review-graph': { status: 'disconnected' } } });
  await old;
  assertPass(await health(plugin, 'race'));
  await plugin['tool.execute.before']({ sessionID: 'race', tool: 'hindsight_diagnose', callID: 'stale-error' }, { args: {} });
  assertPass(await health(plugin, 'race', true));
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'race', callID: 'stale-error', tool: 'hindsight_diagnose', state: { status: 'error' } } } } });
  assertPass(await health(plugin, 'race'));
});

test('native tool errors remain visible without duplicate probes or blocking coding', async t => {
  const { plugin, root, toasts } = await create(t);
  assertPass(await health(plugin, 'runtime'));
  await observation(plugin, root, 'runtime', 'code-review-graph_list_graph_stats_tool', 'raw-envelope');
  assertPass(await health(plugin, 'runtime'));
  const previousFetch = globalThis.fetch;
  let redundantRequests = 0;
  try {
    globalThis.fetch = async (...args) => { redundantRequests++; return previousFetch(...args); };
    await observation(plugin, root, 'runtime', 'hindsight_diagnose', 'successful-diagnose');
    assert.equal(redundantRequests, 0, 'successful native diagnosis must not repeat authenticated bank probes');
  } finally { globalThis.fetch = previousFetch; }
  await observation(plugin, root, 'runtime', 'code-review-graph_list_graph_stats_tool', 'runtime-error', 'error');
  assert.equal((await health(plugin, 'runtime')).graph.status, 'FAIL');
  assert.ok(toasts.some(item => item.message.includes('graph FAIL')));
  await prepareEdit(plugin, root, 'runtime');
  await plugin['tool.execute.before']({ sessionID: 'runtime', tool: 'edit', callID: 'allowed' }, { args: { filePath: 'src/a.js' } });
  await plugin['tool.execute.after']?.({ sessionID: 'runtime', tool: 'edit', callID: 'allowed' }, {});
  assertPass(await health(plugin, 'runtime', true));
});

test('nested host APIs use launch directory while Hindsight and graph resolve the owning worktree', async t => {
  const previousConfig = readFileSync(process.env.HINDSIGHT_CONFIG, 'utf8');
  const previousFetch = globalThis.fetch;
  const urls = [], queries = [];
  try {
    globalThis.fetch = async url => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ status: 'healthy', database: 'connected', total_memories: 1 }) };
    };
    const { plugin, root, directory } = await create(t, async input => {
      queries.push(input.query.directory);
      return { data: { 'code-review-graph': { status: 'connected' } } };
    }, {
      directory: 'YellowStorm/front',
      ids: async input => { queries.push(input.query.directory); return { data: ['hindsight_diagnose'] }; },
      configure: (_root, launchDirectory) => writeFileSync(process.env.HINDSIGHT_CONFIG, JSON.stringify({
        apiUrl: 'http://memory.invalid', retainSessions: true, optInOnly: false,
        paths: { [launchDirectory]: { retainSessions: false } },
        mapPathToBank: { [launchDirectory]: 'incorrect-front-bank' },
      })),
    });
    assertPass(await health(plugin, 'nested-host'));
    assert.deepEqual(queries, [directory, directory]);
    const bankUrls = urls.filter(url => url.includes('/banks/'));
    assert.equal(bankUrls.length, 1);
    assert.ok(bankUrls[0].includes(encodeURIComponent(`coding-agent::${path.basename(root)}`)));
    assert.ok(!bankUrls[0].includes('incorrect-front-bank'));
    // The fixture has a graph only at root: PASS proves the launch subdirectory
    // was not incorrectly used for graph index ownership.
    assert.equal((await health(plugin, 'nested-host')).root, root);
  } finally {
    writeFileSync(process.env.HINDSIGHT_CONFIG, previousConfig);
    globalThis.fetch = previousFetch;
  }
});
