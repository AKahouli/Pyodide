import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './fixture.mjs';

let sandbox, SdlcHarness;
before(async () => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'opencode-startup-plugin-'));
  for (const dir of ['plugins', 'lib']) mkdirSync(path.join(sandbox, dir));
  writeFileSync(path.join(sandbox, 'package.json'), '{"type":"module"}');
  const runtime = new URL('../runtime/', import.meta.url);
  copyFileSync(new URL('plugins/sdlc.js', runtime), path.join(sandbox, 'plugins/sdlc.js'));
  for (const file of readdirSync(new URL('lib/', runtime))) copyFileSync(new URL(`lib/${file}`, runtime), path.join(sandbox, 'lib', file));
  symlinkSync(path.join(homedir(), '.config/opencode/node_modules'), path.join(sandbox, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  ({ SdlcHarness } = await import(pathToFileURL(path.join(sandbox, 'plugins/sdlc.js'))));
});
after(() => {
  unlinkSync(path.join(sandbox, 'node_modules'));
  assert.equal(path.dirname(sandbox), tmpdir());
  rmSync(sandbox, { recursive: true, force: true });
});

async function create(t, options = {}) {
  const repo = fixture();
  mkdirSync(path.join(repo.root, 'graphify-out'));
  writeFileSync(path.join(repo.root, 'graphify-out/graph.json'), JSON.stringify({ directed: false, multigraph: false, graph: { schema_version: 1, graphify_version: 'test' }, nodes: [{ id: 'a', label: 'A', source_file: 'src/a.js' }], links: [] }));
  writeFileSync(path.join(repo.root, 'graphify-out/.graphify_root'), repo.root);
  const toasts = [];
  const directory = path.join(repo.root, options.directory || '');
  mkdirSync(directory, { recursive: true });
  options.configure?.(repo.root, directory);
  const client = { tui: { showToast: async input => { toasts.push(input.body); } } };
  const plugin = await SdlcHarness({ worktree: repo.root, directory, client });
  t.after(async () => { await plugin.dispose?.(); repo.cleanup(); });
  return { plugin, root: repo.root, directory, toasts };
}
const health = async (plugin, sid, refresh = false) => JSON.parse(await plugin.tool.sdlc_health.execute({ refresh }, { sessionID: sid }));
function assertPass(report) {
  for (const key of ['graph', 'checkpoints']) assert.equal(report[key].status, 'PASS', `${key}: ${report[key].reason}`);
}
async function prepareEdit(plugin, root, sid) {
  return plugin.tool.sdlc_checkpoint.execute({ goal: 'Test advisory checkpoints', acceptance: ['Normal edits remain available'], nextAction: 'Continue' }, { sessionID: sid });
}
async function graphifyObservation(plugin, root, sid, callID, command = 'graphify query "test"', status = 'completed') {
  await plugin['tool.execute.before']({ sessionID: sid, tool: 'bash', callID }, { args: { command } });
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: sid, callID, tool: 'bash', state: { status, input: { command }, error: status === 'error' ? 'Synthetic graphify failure' : undefined } } } } });
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
  assert.equal(first.hindsight, undefined, 'hindsight is no longer a health service');
  await prepareEdit(plugin, root, 'first');
});

test('concurrent sessions share pending process probes but retain their own cached receipts', async t => {
  const { plugin } = await create(t);
  const reports = await Promise.all([health(plugin, 'parallel-first'), health(plugin, 'parallel-second')]);
  reports.forEach(assertPass);
  assert.notEqual(reports[0].probe, reports[1].probe);
  assert.deepEqual(await health(plugin, 'parallel-first'), reports[0]);
});

test('native shell permissions remain authoritative during graph failures', async t => {
  const { plugin } = await create(t, { configure: root => rmSync(path.join(root, 'graphify-out'), { recursive: true, force: true }) });
  assert.equal((await health(plugin, 'diagnose')).graph.status, 'FAIL');
  for (const command of ['powershell.exe -NoProfile -File scripts/start-local.ps1', 'pwsh -File ./scripts/start-local.ps1', 'Get-Content logs/worker.log -Tail 80', 'npm run build', 'git status --short']) {
    const output = { args: { command } };
    await plugin['tool.execute.before']({ sessionID: 'diagnose', tool: 'bash', callID: command }, output);
    assert.equal(output.args.command, command);
  }
  await plugin['tool.execute.before']({ sessionID: 'diagnose', tool: 'edit', callID: 'edit' }, { args: { filePath: 'src/a.js' } });
});

test('graph failures allow overlapping coding without checkpoint preparation', async t => {
  const { plugin, root, toasts } = await create(t, { configure: root => rmSync(path.join(root, 'graphify-out'), { recursive: true, force: true }) });
  const receipt = await health(plugin, 'coding');
  assert.equal(receipt.graph.status, 'FAIL');
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
  const fallback = await SdlcHarness({ worktree: root, directory: root, client: { tui: { showToast: async input => { toasts.push(input.body); } } } });
  const report = await health(fallback, 'missing-policy');
  assert.equal(report.checkpoints.status, 'FAIL');
  assert.equal(fallback['tool.execute.before'], undefined, 'fallback mode never intercepts tool calls; native permissions stay authoritative');
  await fallback['tool.execute.before']?.({ sessionID: 'missing-policy', tool: 'task', callID: 'maintainer' }, { args: { subagent_type: 'maintainer' } });
  await fallback['tool.execute.before']?.({ sessionID: 'missing-policy', tool: 'task', callID: 'maintainer-background' }, { args: { subagent_type: 'maintainer', background: true } });
  assert.ok(toasts.some(item => item.message.includes('checkpoints FAIL')));
});

test('refresh supersedes stale graphify tool errors through generation fencing', async t => {
  const { plugin } = await create(t);
  assertPass(await health(plugin, 'race'));
  await plugin['tool.execute.before']({ sessionID: 'race', tool: 'bash', callID: 'stale-error' }, { args: { command: 'graphify query "x"' } });
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'race', callID: 'stale-error', tool: 'bash', state: { status: 'completed' } } } } });
  assertPass(await health(plugin, 'race'));
  // A late error for an already-completed call must not retroactively fail the graph.
  await plugin['tool.execute.before']({ sessionID: 'race', tool: 'bash', callID: 'late-error' }, { args: { command: 'graphify query "y"' } });
  assertPass(await health(plugin, 'race', true));
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'race', callID: 'late-error', tool: 'bash', state: { status: 'error' } } } } });
  assertPass(await health(plugin, 'race'));
});

test('native tool errors remain visible without duplicate probes or blocking coding', async t => {
  const { plugin, root, toasts } = await create(t);
  assertPass(await health(plugin, 'runtime'));
  await graphifyObservation(plugin, root, 'runtime', 'raw-envelope');
  assertPass(await health(plugin, 'runtime'));
  await graphifyObservation(plugin, root, 'runtime', 'runtime-error', 'graphify query "impacts"', 'error');
  assert.equal((await health(plugin, 'runtime')).graph.status, 'FAIL');
  assert.ok(toasts.some(item => item.message.includes('graph FAIL')));
  await prepareEdit(plugin, root, 'runtime');
  await plugin['tool.execute.before']({ sessionID: 'runtime', tool: 'edit', callID: 'allowed' }, { args: { filePath: 'src/a.js' } });
  await plugin['tool.execute.after']?.({ sessionID: 'runtime', tool: 'edit', callID: 'allowed' }, {});
  assertPass(await health(plugin, 'runtime', true));
});

test('non-graphify bash failures do not affect graph health', async t => {
  const { plugin, root } = await create(t);
  assertPass(await health(plugin, 'unrelated'));
  await plugin['tool.execute.before']({ sessionID: 'unrelated', tool: 'bash', callID: 'npm-error' }, { args: { command: 'npm test -- broken' } });
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'unrelated', callID: 'npm-error', tool: 'bash', state: { status: 'error' } } } } });
  assertPass(await health(plugin, 'unrelated'));
});

test('graph probe resolves the owning worktree, not the launch directory', async t => {
  const { plugin, root } = await create(t, { directory: 'YellowStorm/front' });
  const report = await health(plugin, 'nested-host');
  assertPass(report);
  assert.equal(report.root, root);
});
