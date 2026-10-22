import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './fixture.mjs';

let sandbox, definition;
before(async () => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'opencode-startup-plugin-'));
  for (const dir of ['plugins', 'lib']) mkdirSync(path.join(sandbox, dir));
  writeFileSync(path.join(sandbox, 'package.json'), '{"type":"module"}');
  const runtime = new URL('../runtime/', import.meta.url);
  copyFileSync(new URL('plugins/sdlc.js', runtime), path.join(sandbox, 'plugins/sdlc.js'));
  for (const file of readdirSync(new URL('lib/', runtime))) copyFileSync(new URL(`lib/${file}`, runtime), path.join(sandbox, 'lib', file));
  if (process.env.HARNESS_TEST_NODE_MODULES) symlinkSync(process.env.HARNESS_TEST_NODE_MODULES, path.join(sandbox, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  else execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', sandbox, '--no-audit', '--no-fund', '--save-exact', '@opencode/plugin@2.1.2'], { stdio: 'pipe', shell: process.platform === 'win32', windowsHide: true });
  ({ default: definition } = await import(pathToFileURL(path.join(sandbox, 'plugins/sdlc.js'))));
  assert.equal(definition.id, 'yellowstorm.sdlc');
});
after(() => {
  if (process.env.HARNESS_TEST_NODE_MODULES) unlinkSync(path.join(sandbox, 'node_modules'));
  assert.equal(path.dirname(sandbox), tmpdir());
  rmSync(sandbox, { recursive: true, force: true });
});

// Keep the existing behavioral regressions while dispatching through V2 registrations.
async function loadPlugin(root, directory) {
  const tools = {}, sessionHooks = {}, toolHooks = {};
  let push, finish, subscriptionSignal;
  const ctx = {
    location: { directory, project: { directory: root, canonical: root } },
    tool: {
      transform: async callback => callback({ add: tool => { tools[tool.name] = tool; } }),
      hook: async (name, callback) => { toolHooks[name] = callback; },
    },
    session: { hook: async (name, callback) => { sessionHooks[name] = callback; } },
    event: { subscribe: ({ signal }) => {
      subscriptionSignal = signal;
      return { [Symbol.asyncIterator]() { return this; }, next() {
        return new Promise(resolve => {
          finish = () => resolve({ done: true });
          push = event => resolve({ done: false, value: event });
          signal.addEventListener('abort', finish, { once: true });
        });
      } };
    } },
  };
  const cleanup = await definition.setup(ctx);
  const plugin = {
    tools, sessionHooks, toolHooks,
    tool: Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, { execute: async (args, context) => (await tool.execute(args, context)).content }])),
    'chat.message': (input, output) => sessionHooks.prompt({ sessionID: input.sessionID, prompt: { text: output.parts.filter(part => part.type === 'text' && !part.synthetic).map(part => part.text).join('\n') } }),
    'experimental.chat.system.transform': async (input, output) => {
      const event = { sessionID: input.sessionID, system: [] };
      await sessionHooks.context(event);
      output.system.push(...event.system.map(part => part.text));
    },
    event: async ({ event }) => {
      const part = event.properties?.part;
      if (part) await toolHooks['execute.after']?.({ sessionID: part.sessionID, tool: part.tool, id: part.callID, status: part.state.status });
    },
    emit: async event => { push(event); await new Promise(resolve => setImmediate(resolve)); },
    dispose: cleanup,
    get subscriptionSignal() { return subscriptionSignal; },
  };
  if (toolHooks['execute.before']) plugin['tool.execute.before'] = (input, output) => toolHooks['execute.before']({ sessionID: input.sessionID, tool: input.tool, id: input.callID, input: output.args });
  if (toolHooks['execute.after']) plugin['tool.execute.after'] = (input, output) => toolHooks['execute.after']({ sessionID: input.sessionID, tool: input.tool, id: input.callID, input: output.args, status: 'completed', result: {} });
  return plugin;
}

async function create(t, options = {}) {
  const repo = fixture();
  mkdirSync(path.join(repo.root, 'graphify-out'));
  writeFileSync(path.join(repo.root, 'graphify-out/graph.json'), JSON.stringify({ directed: false, multigraph: false, graph: { schema_version: 1, graphify_version: 'test' }, nodes: [{ id: 'a', label: 'A', source_file: 'src/a.js' }], links: [] }));
  writeFileSync(path.join(repo.root, 'graphify-out/.graphify_root'), repo.root);
  const directory = path.join(repo.root, options.directory || '');
  mkdirSync(directory, { recursive: true });
  options.configure?.(repo.root, directory);
  const plugin = await loadPlugin(repo.root, directory);
  t.after(async () => { await plugin.dispose?.(); repo.cleanup(); });
  return { plugin, root: repo.root, directory };
}
const health = async (plugin, sid, refresh = false) => JSON.parse(await plugin.tool.sdlc_health.execute({ refresh }, { sessionID: sid }));
function assertPass(report) {
  for (const key of ['graph', 'checkpoints']) assert.equal(report[key].status, 'PASS', `${key}: ${report[key].reason}`);
}
async function prepareEdit(plugin, root, sid) {
  return plugin.tool.sdlc_checkpoint.execute({ goal: 'Test advisory checkpoints', acceptance: ['Normal edits remain available'], nextAction: 'Continue' }, { sessionID: sid });
}
async function graphifyObservation(plugin, root, sid, callID, command = 'graphify query "test"', status = 'completed') {
  await plugin['tool.execute.before']({ sessionID: sid, tool: 'shell', callID }, { args: { command } });
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: sid, callID, tool: 'shell', state: { status, input: { command }, error: status === 'error' ? 'Synthetic graphify failure' : undefined } } } } });
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
    await plugin['tool.execute.before']({ sessionID: 'diagnose', tool: 'shell', callID: command }, output);
    assert.equal(output.args.command, command);
  }
  await plugin['tool.execute.before']({ sessionID: 'diagnose', tool: 'edit', callID: 'edit' }, { args: { filePath: 'src/a.js' } });
});

test('graph failures allow overlapping coding without checkpoint preparation', async t => {
  const { plugin, root } = await create(t, { configure: root => rmSync(path.join(root, 'graphify-out'), { recursive: true, force: true }) });
  const receipt = await health(plugin, 'coding');
  assert.equal(receipt.graph.status, 'FAIL');
  assert.equal(receipt.checkpoints.status, 'PASS');
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
  const { root } = await create(t);
  rmSync(path.join(root, 'tools/opencode-harness/policy.json'));
  const fallback = await loadPlugin(root, root);
  t.after(() => fallback.dispose());
  const report = await health(fallback, 'missing-policy');
  assert.equal(report.checkpoints.status, 'FAIL');
  assert.equal(fallback['tool.execute.before'], undefined, 'fallback mode never intercepts tool calls; native permissions stay authoritative');
  await fallback['tool.execute.before']?.({ sessionID: 'missing-policy', tool: 'task', callID: 'maintainer' }, { args: { subagent_type: 'maintainer' } });
  await fallback['tool.execute.before']?.({ sessionID: 'missing-policy', tool: 'task', callID: 'maintainer-background' }, { args: { subagent_type: 'maintainer', background: true } });
  const context = { system: [] };
  await fallback['experimental.chat.system.transform']({ sessionID: 'missing-policy' }, context);
  assert.match(context.system.join(' '), /checkpoints FAIL/);
});

test('graphify invocations are counted in health receipts', async t => {
  const { plugin, root } = await create(t);
  assertPass(await health(plugin, 'counted'));
  assert.equal((await health(plugin, 'counted')).graphifyInvocations, 0);
  await plugin['tool.execute.before']({ sessionID: 'counted', tool: 'shell', callID: 'q1' }, { args: { command: 'graphify query "x"' } });
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'counted', callID: 'q1', tool: 'shell', state: { status: 'completed' } } } } });
  assert.equal((await health(plugin, 'counted')).graphifyInvocations, 1);
  await plugin['tool.execute.before']({ sessionID: 'counted', tool: 'shell', callID: 'n1' }, { args: { command: 'npm test -- focused' } });
  await plugin['tool.execute.before']({ sessionID: 'counted', tool: 'edit', callID: 'e1' }, { args: { filePath: 'src/a.js' } });
  assert.equal((await health(plugin, 'counted')).graphifyInvocations, 1, 'only graphify bash calls count');
  await plugin['tool.execute.before']({ sessionID: 'counted', tool: 'shell', callID: 'q2' }, { args: { command: 'graphify explain "y"' } });
  assert.equal((await health(plugin, 'counted', true)).graphifyInvocations, 2, 'refresh keeps the cumulative count');
});

test('refresh supersedes stale graphify tool errors through generation fencing', async t => {
  const { plugin } = await create(t);
  assertPass(await health(plugin, 'race'));
  await plugin['tool.execute.before']({ sessionID: 'race', tool: 'shell', callID: 'stale-error' }, { args: { command: 'graphify query "x"' } });
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'race', callID: 'stale-error', tool: 'shell', state: { status: 'completed' } } } } });
  assertPass(await health(plugin, 'race'));
  // A late error for an already-completed call must not retroactively fail the graph.
  await plugin['tool.execute.before']({ sessionID: 'race', tool: 'shell', callID: 'late-error' }, { args: { command: 'graphify query "y"' } });
  assertPass(await health(plugin, 'race', true));
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'race', callID: 'late-error', tool: 'shell', state: { status: 'error' } } } } });
  assertPass(await health(plugin, 'race'));
});

test('native tool errors remain visible without duplicate probes or blocking coding', async t => {
  const { plugin, root } = await create(t);
  assertPass(await health(plugin, 'runtime'));
  await graphifyObservation(plugin, root, 'runtime', 'raw-envelope');
  assertPass(await health(plugin, 'runtime'));
  await graphifyObservation(plugin, root, 'runtime', 'runtime-error', 'graphify query "impacts"', 'error');
  assert.equal((await health(plugin, 'runtime')).graph.status, 'FAIL');
  assert.match((await health(plugin, 'runtime')).graph.reason, /Graphify CLI query failed/);
  await prepareEdit(plugin, root, 'runtime');
  await plugin['tool.execute.before']({ sessionID: 'runtime', tool: 'edit', callID: 'allowed' }, { args: { filePath: 'src/a.js' } });
  await plugin['tool.execute.after']?.({ sessionID: 'runtime', tool: 'edit', callID: 'allowed' }, {});
  assertPass(await health(plugin, 'runtime', true));
});

test('non-graphify bash failures do not affect graph health', async t => {
  const { plugin, root } = await create(t);
  assertPass(await health(plugin, 'unrelated'));
  await plugin['tool.execute.before']({ sessionID: 'unrelated', tool: 'shell', callID: 'npm-error' }, { args: { command: 'npm test -- broken' } });
  await plugin.event({ event: { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'unrelated', callID: 'npm-error', tool: 'shell', state: { status: 'error' } } } } });
  assertPass(await health(plugin, 'unrelated'));
});

test('graph probe resolves the owning worktree, not the launch directory', async t => {
  const { plugin, root } = await create(t, { directory: 'YellowStorm/front' });
  const report = await health(plugin, 'nested-host');
  assertPass(report);
  assert.equal(report.root, root);
});

test('V2 tools, prompt/context/compaction hooks and subscription cleanup use native contracts', async t => {
  const { plugin, root } = await create(t);
  assert.deepEqual(Object.keys(plugin.tools).sort(), ['sdlc_checkpoint', 'sdlc_health', 'sdlc_resume']);
  assert.equal(plugin.tools.sdlc_checkpoint.input.properties.goal.maxLength, 1000);
  assert.equal(plugin.tools.sdlc_checkpoint.input.additionalProperties, false);
  assert.equal(plugin.tools.sdlc_checkpoint.args, undefined, 'V1 SDK schemas are not registered');
  await plugin.emit({ type: 'session.created', data: { sessionID: 'created-native', location: { directory: root } } });
  assertPass(await health(plugin, 'created-native'));
  await plugin.sessionHooks.prompt({ sessionID: 'native', prompt: { text: 'Inspect the installer' } });
  const result = await plugin.tools.sdlc_checkpoint.execute({ goal: 'Native V2 checkpoint', nextAction: 'Check context' }, { sessionID: 'native' });
  assert.equal(JSON.parse(result.content).saved, true);
  const context = { sessionID: 'native', system: [] };
  await plugin.sessionHooks.context(context);
  assert.ok(context.system.every(part => part.type === 'text' && typeof part.text === 'string'));
  assert.match(context.system.map(part => part.text).join('\n'), /Native V2 checkpoint/);
  const compact = { sessionID: 'native', system: [] };
  await plugin.sessionHooks.compaction(compact);
  assert.match(compact.system[0].text, /Native V2 checkpoint/);
  await plugin.emit({ type: 'session.status', data: { sessionID: 'native', status: { type: 'idle' } } });
  const parked = { sessionID: 'native', system: [] };
  await plugin.sessionHooks.context(parked);
  assert.match(parked.system.map(part => part.text).join('\n'), /"status":"waiting"/);
  assert.equal(plugin.subscriptionSignal.aborted, false);
  await plugin.dispose();
  plugin.dispose = undefined;
  assert.equal(plugin.subscriptionSignal.aborted, true);
});
