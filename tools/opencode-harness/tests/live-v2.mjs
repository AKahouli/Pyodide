// No provider/model call: exercise the released V2 plugin host in a disposable profile.
// Defaults to the one-click install; executable and SDK directory can be overridden.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const executable = process.argv[2] || path.join(homedir(), '.opencode/bin/opencode.exe');
const dependencies = process.env.HARNESS_TEST_NODE_MODULES || path.join(homedir(), '.config/opencode/node_modules');
if (!existsSync(executable) || !existsSync(path.join(dependencies, '@opencode/plugin'))) throw Error('Run Install-Harness.cmd first, or pass a native V2 executable and set HARNESS_TEST_NODE_MODULES to an installed @opencode/plugin@2.1.2 dependency directory.');
const root = mkdtempSync(path.join(tmpdir(), 'opencode-live-v2-'));
const repo = path.join(root, 'repo'), config = path.join(root, 'config'), result = path.join(root, 'result.json');
for (const dir of [repo, config, path.join(repo, 'tools/opencode-harness'), path.join(repo, 'graphify-out'), path.join(config, 'plugins')]) mkdirSync(dir, { recursive: true });
writeFileSync(path.join(repo, 'tools/opencode-harness/policy.json'), JSON.stringify({ documentationIndex: 'README.md', documentationRoutes: [] }));
writeFileSync(path.join(repo, 'README.md'), '# Disposable V2 fixture\n');
writeFileSync(path.join(repo, 'graphify-out/graph.json'), JSON.stringify({ graph: { schema_version: 1 }, nodes: [{ id: 'a', source_file: 'README.md' }], links: [] }));
writeFileSync(path.join(repo, 'graphify-out/.graphify_root'), repo);
for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Harness test', '-c', 'user.email=harness@example.invalid', '-c', 'core.hooksPath=.no-hooks', 'commit', '-qm', 'Fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'pipe', windowsHide: true });
const runtime = new URL('../runtime/', import.meta.url);
// Keep the relative runtime import layout without discovering the plugin twice.
mkdirSync(path.join(config, 'runtime/plugins'), { recursive: true });
mkdirSync(path.join(config, 'runtime/lib'), { recursive: true });
copyFileSync(new URL('plugins/sdlc.js', runtime), path.join(config, 'runtime/plugins/sdlc.js'));
for (const file of ['sdlc-core.mjs', 'startup-health.mjs']) copyFileSync(new URL(`lib/${file}`, runtime), path.join(config, 'runtime/lib', file));
symlinkSync(dependencies, path.join(config, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
writeFileSync(path.join(config, 'package.json'), '{"type":"module"}');
writeFileSync(path.join(config, 'opencode.json'), '{}');
writeFileSync(path.join(config, 'plugins/probe.js'), `
import { Plugin } from '@opencode/plugin';
import fs from 'node:fs';
import harness from '../runtime/plugins/sdlc.js';
export default Plugin.define({ id: 'harness.native-probe', async setup(ctx) {
  const cleanup = await harness.setup(ctx);
  const tools = await ctx.tool.list();
  const health = tools.find(tool => tool.name === 'sdlc_health');
  const checkpoint = tools.find(tool => tool.name === 'sdlc_checkpoint');
  const report = { tools: tools.map(tool => tool.name), location: ctx.location };
  if (health && checkpoint) {
    report.health = JSON.parse((await health.execute({}, { sessionID: 'ses_native_fixture' })).content);
    report.checkpoint = JSON.parse((await checkpoint.execute({ goal: 'Native V2 smoke', nextAction: 'Done' }, { sessionID: 'ses_native_fixture' })).content);
  }
  fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify(report));
  return cleanup;
} });
`);
const env = { ...process.env, USERPROFILE: root, HOME: root, XDG_CONFIG_HOME: root, XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'), OPENCODE_CONFIG_DIR: config, OPENCODE_DB: path.join(root, 'opencode.db') };
// XDG config defaults to <XDG_CONFIG_HOME>/opencode; use the explicit config directory too.
mkdirSync(path.join(root, 'opencode'), { recursive: true });
writeFileSync(path.join(root, 'opencode/opencode.json'), JSON.stringify({ plugins: [path.join(config, 'plugins/probe.js')] }));
let output = '';
const child = spawn(executable, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
try {
  const deadline = Date.now() + 45000;
  while (!output.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)) {
    assert.equal(child.exitCode, null, 'Native server exited before startup');
    assert.ok(Date.now() < deadline, 'Native server startup timed out');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const base = output.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)[1];
  const password = output.match(/server password (\S+)/)?.[1];
  const headers = { 'x-opencode-directory': encodeURIComponent(repo) };
  if (password) headers.authorization = `Basic ${Buffer.from('opencode:' + password).toString('base64')}`;
  const response = await fetch(`${base}/api/plugin`, { headers, signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `Native plugin endpoint failed: ${await response.text()}`);
  while (!existsSync(result)) {
    assert.ok(Date.now() < deadline, 'Plugin probe did not complete');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const report = JSON.parse(readFileSync(result, 'utf8'));
  for (const name of ['sdlc_health', 'sdlc_checkpoint', 'sdlc_resume']) assert.ok(report.tools.includes(name), `Missing tool ${name}`);
  assert.equal(report.health.root.toLowerCase(), repo.toLowerCase());
  assert.equal(report.health.checkpoints.status, 'PASS');
  assert.equal(report.checkpoint.saved, true);
  console.log('PASS: native V2 plugin loaded; three tools registered; isolated health/checkpoint execution passed. No model called.');
} finally {
  child.kill();
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  // This exact disposable directory was created above; remove only its contents.
  assert.equal(path.dirname(root), tmpdir());
  rmSync(root, { recursive: true, force: true });
}
