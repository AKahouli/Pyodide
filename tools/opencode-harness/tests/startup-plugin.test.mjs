import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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

async function create(t, status = async () => ({ data: { 'code-review-graph': { status: 'connected' } } })) {
  const repo = fixture();
  const toasts = [];
  const client = { mcp: { status }, tool: { ids: async () => ({ data: ['hindsight_diagnose'] }) }, tui: { showToast: async input => { toasts.push(input.body); } } };
  const plugin = await SdlcHarness({ worktree: repo.root, directory: repo.root, client });
  t.after(async () => { await plugin.dispose?.(); repo.cleanup(); });
  return { plugin, root: repo.root, toasts };
}
const health = async (plugin, sid, refresh = false) => JSON.parse(await plugin.tool.sdlc_health.execute({ refresh }, { sessionID: sid }));
async function observation(plugin, root, sid, tool, callID) {
  const args = tool === 'hindsight_diagnose' ? {} : { repo_root: root };
  await plugin['tool.execute.before']({ sessionID: sid, tool, callID }, { args });
  const output = tool === 'hindsight_diagnose'
    ? { workspace: root, bank_id: 'synthetic-plugin-bank', config: { api_url: 'http://memory.invalid', disabled: false }, credential: { api_token_matches_config: true } }
    : { status: 'ok', total_nodes: 5 };
  await plugin['tool.execute.after']({ sessionID: sid, tool, callID }, { output: JSON.stringify(output) });
}
async function pass(plugin, root, sid) {
  await observation(plugin, root, sid, 'code-review-graph_list_graph_stats_tool', `${sid}-graph`);
  await observation(plugin, root, sid, 'hindsight_diagnose', `${sid}-memory`);
}

test('native observations establish own PASS receipt and prepare gate; another session stays pending', async t => {
  const { plugin, root } = await create(t);
  await health(plugin, 'first');
  await assert.rejects(plugin.tool.sdlc_prepare.execute({ targets: ['src/a.js'], documents: [], sources: [], reuseDecision: 'reuse' }, { sessionID: 'first' }), /startup|health|integration/i);
  await pass(plugin, root, 'first');
  const report = await health(plugin, 'first');
  for (const key of ['graph', 'hindsight', 'checkpoints']) assert.equal(report[key].status, 'PASS');
  const another = await health(plugin, 'second');
  assert.equal(another.graph.status, 'PENDING'); assert.equal(another.hindsight.status, 'PENDING');
  await plugin.tool.sdlc_checkpoint.execute({ goal: 'Test guarded reuse', acceptance: ['Read evidence accepted'], nextAction: 'Edit owned source' }, { sessionID: 'first' });
  for (const file of ['docs/agent-context/README.md', 'guidelines.md', 'src/a.js']) {
    const callID = `read-${file}`;
    await plugin['tool.execute.before']({ sessionID: 'first', tool: 'read', callID }, { args: { filePath: path.join(root, file) } });
    await plugin['tool.execute.after']({ sessionID: 'first', tool: 'read', callID }, { output: 'synthetic successful read' });
  }
  await plugin.tool.sdlc_prepare.execute({ targets: ['src/a.js'], documents: ['docs/agent-context/README.md', 'guidelines.md'], sources: ['src/a.js'], reuseDecision: 'Reuse existing value export' }, { sessionID: 'first' });
});

test('missing policy reports failure and blocks every shell command and native edit', async t => {
  const { plugin, root, toasts } = await create(t);
  rmSync(path.join(root, 'tools/opencode-harness/policy.json'));
  const fallback = await SdlcHarness({ worktree: root, directory: root, client: { mcp: { status: async () => ({ data: { 'code-review-graph': { status: 'connected' } } }) }, tui: { showToast: async input => { toasts.push(input.body); } } } });
  const report = await health(fallback, 'missing-policy');
  assert.equal(report.checkpoints.status, 'FAIL');
  assert.ok(toasts.some(item => item.message.includes('checkpoints FAIL')));
  for (const [tool, args] of [['bash', { command: 'git status' }], ['bash', { command: 'git diff --output=src/a.js' }], ['edit', { filePath: 'src/a.js' }], ['write', { filePath: 'src/a.js' }]]) {
    await assert.rejects(fallback['tool.execute.before']({ sessionID: 'missing-policy', tool, callID: tool }, { args }), /checkpoint integration unavailable/);
  }
});

test('refresh supersedes delayed startup failures and stale integration tool errors', async t => {
  let resolveOld, entered;
  const oldEntered = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  const { plugin, root } = await create(t, async () => {
    calls++;
    if (calls === 1) { entered(); return new Promise(resolve => { resolveOld = resolve; }); }
    return { data: { 'code-review-graph': { status: 'connected' } } };
  });
  const old = health(plugin, 'race');
  await oldEntered;
  await health(plugin, 'race', true);
  await pass(plugin, root, 'race');
  resolveOld({ data: { 'code-review-graph': { status: 'disconnected' } } });
  await old;
  assert.equal((await health(plugin, 'race')).graph.status, 'PASS');
  await plugin['tool.execute.before']({ sessionID: 'race', tool: 'hindsight_diagnose', callID: 'stale-error' }, { args: {} });
  await health(plugin, 'race', true);
  await pass(plugin, root, 'race');
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'race', callID: 'stale-error', tool: 'hindsight_diagnose', state: { status: 'error' } } } } });
  const final = await health(plugin, 'race');
  assert.equal(final.graph.status, 'PASS'); assert.equal(final.hindsight.status, 'PASS');
});

test('health waits for same-session in-flight native probes instead of returning stale pending', async t => {
  const { plugin, root } = await create(t);
  await health(plugin, 'parallel-probes');
  const graphTool = 'code-review-graph_list_graph_stats_tool';
  await plugin['tool.execute.before']({ sessionID: 'parallel-probes', tool: graphTool, callID: 'parallel-graph' }, { args: { repo_root: root } });
  await plugin['tool.execute.before']({ sessionID: 'parallel-probes', tool: 'hindsight_diagnose', callID: 'parallel-memory' }, { args: {} });
  let settled = false;
  const waiting = health(plugin, 'parallel-probes').then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  await plugin['tool.execute.after']({ sessionID: 'parallel-probes', tool: graphTool, callID: 'parallel-graph' }, { output: JSON.stringify({ status: 'ok', total_nodes: 3 }) });
  await plugin['tool.execute.after']({ sessionID: 'parallel-probes', tool: 'hindsight_diagnose', callID: 'parallel-memory' }, { output: JSON.stringify({ workspace: root, bank_id: 'synthetic-plugin-bank', config: { api_url: 'http://memory.invalid', disabled: false }, credential: { api_token_matches_config: true } }) });
  const result = await waiting;
  assert.equal(result.graph.status, 'PASS');
  assert.equal(result.hindsight.status, 'PASS');
  assert.equal(result.checkpoints.status, 'PASS');
});
