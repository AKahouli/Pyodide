import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const helper = fileURLToPath(new URL('../setup-config.mjs', import.meta.url));
const sdk = mkdtempSync(path.join(tmpdir(), 'harness-setup-tests-'));
let jsonc;
before(() => {
  const install = ['install', '--prefix', sdk, '--no-audit', '--no-fund', '--ignore-scripts', 'jsonc-parser@3.3.1'];
  if (process.platform === 'win32') {
    const npm = execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    execFileSync(process.execPath, [path.join(path.dirname(npm), 'node_modules/npm/bin/npm-cli.js'), ...install], { stdio: 'pipe' });
  } else execFileSync('npm', install, { stdio: 'pipe' });
  jsonc = createRequire(path.join(sdk, 'package.json'))('jsonc-parser');
  mkdirSync(path.join(sdk, 'node_modules/@opencode-ai/plugin'), { recursive: true });
});
after(() => rmSync(sdk, { recursive: true, force: true }));
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'harness-setup-fixture-'));
  const config = path.join(root, 'config'), repo = path.join(root, 'project'), backup = path.join(root, 'backup'), memory = path.join(root, 'memory.json');
  mkdirSync(config); mkdirSync(repo); mkdirSync(backup);
  execFileSync('git', ['init', '-q', repo]);
  const link = path.join(config, 'node_modules');
  symlinkSync(path.join(sdk, 'node_modules'), link, process.platform === 'win32' ? 'junction' : 'dir');
  return { root, config, repo, backup, memory, cleanup() { unlinkSync(link); rmSync(root, { recursive: true, force: true }); } };
}
function run(f, action, extra = {}) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('HINDSIGHT_')));
    const child = spawn(process.execPath, [helper, action, f.config, f.repo, f.backup], { env: { ...env, HINDSIGHT_CONFIG: f.memory, ...extra }, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value);
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
const backups = dir => readdirSync(dir, { recursive: true }).filter(name => statSync(path.join(dir, name)).isFile());

test('setup merges defaults into JSONC without changing personal configuration or comments', async () => {
  const f = fixture();
  try {
    const file = path.join(f.config, 'opencode.jsonc');
    const original = '{\n // Personal provider remains intact\n "provider": {"custom":{"options":{"apiKey":"fixture-secret"}}},\n "model":"custom/model", "plugin":["personal-plugin"],\n "permission":{"bash":"ask"}, "mcp":{"context7":{"enabled":false}},\n}\n';
    writeFileSync(file, original);
    const result = await run(f, 'opencode'); assert.equal(result.code, 0, result.stderr);
    const text = readFileSync(file, 'utf8'), cfg = jsonc.parse(text);
    assert.ok(text.includes('// Personal provider remains intact'));
    assert.deepEqual(cfg.provider, jsonc.parse(original).provider);
    assert.equal(cfg.model, 'custom/model'); assert.deepEqual(cfg.plugin, ['personal-plugin']);
    assert.equal(cfg.permission.bash, 'ask'); assert.equal(cfg.mcp.context7.enabled, false);
    assert.equal(cfg.mcp['code-review-graph'].enabled, true);
    assert.equal(cfg.compaction.auto, true);
    assert.ok(backups(f.backup).some(name => readFileSync(path.join(f.backup, name), 'utf8') === original));
    assert.ok(!result.stdout.includes('fixture-secret') && !result.stderr.includes('fixture-secret'));
    const again = await run(f, 'opencode'); assert.equal(again.code, 0, again.stderr);
    assert.equal(readFileSync(file, 'utf8'), text, 'repeat setup must be idempotent');
  } finally { f.cleanup(); }
});

test('invalid or competing OpenCode configs fail without rewriting', async () => {
  const f = fixture();
  try {
    const file = path.join(f.config, 'opencode.jsonc'), malformed = '{ "provider": broken }';
    writeFileSync(file, malformed);
    assert.notEqual((await run(f, 'opencode')).code, 0);
    assert.equal(readFileSync(file, 'utf8'), malformed);
    writeFileSync(file, '{}'); writeFileSync(path.join(f.config, 'opencode.json'), '{"model":"personal"}');
    assert.notEqual((await run(f, 'opencode')).code, 0);
    assert.equal(readFileSync(file, 'utf8'), '{}');
    assert.equal(readFileSync(path.join(f.config, 'opencode.json'), 'utf8'), '{"model":"personal"}');
  } finally { f.cleanup(); }
});

test('existing plain JSON remains the selected config and keeps personal model', async () => {
  const f = fixture();
  try {
    const file = path.join(f.config, 'opencode.json'); writeFileSync(file, '{"model":"personal/model"}');
    const result = await run(f, 'opencode'); assert.equal(result.code, 0, result.stderr);
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(cfg.model, 'personal/model'); assert.equal(cfg.compaction.prune, true);
    assert.equal(readdirSync(f.config).includes('opencode.jsonc'), false);
  } finally { f.cleanup(); }
});

test('memory registration checks the native config rather than installer messages', async () => {
  const f = fixture();
  try {
    const file = path.join(f.config, 'opencode.json'); writeFileSync(file, '{"plugin":["personal-plugin"]}');
    assert.notEqual((await run(f, 'memory-registration')).code, 0);
    for (const entry of ['file:///C:/Users/test/.hindsight/coding-agents/dist/opencode.js', ['file:///C:/Users/test/.hindsight/coding-agents/dist/opencode.js', {}], 'C:\\Users\\test\\.hindsight\\coding-agents', ['file:///C:/Users/test/.hindsight/coding-agents', {}]]) {
      writeFileSync(file, JSON.stringify({ plugin: ['personal-plugin', entry] }));
      const result = await run(f, 'memory-registration'); assert.equal(result.code, 0, result.stderr);
    }
  } finally { f.cleanup(); }
});

test('setup preserves relative permission order and effective last-match denial', async () => {
  const f = fixture();
  try {
    const file = path.join(f.config, 'opencode.json');
    writeFileSync(file, JSON.stringify({ agent: { build: { permission: { bash: { 'git push*': 'allow', '*': 'deny' } } } } }));
    const result = await run(f, 'opencode'); assert.equal(result.code, 0, result.stderr);
    const rules = JSON.parse(readFileSync(file, 'utf8')).agent.build.permission.bash;
    const keys = Object.keys(rules);
    assert.ok(keys.indexOf('git push*') < keys.indexOf('*'));
    const matching = Object.entries(rules).filter(([pattern]) => pattern === '*' || pattern === 'git push*');
    assert.equal(matching.at(-1)[1], 'deny');
  } finally { f.cleanup(); }
});

test('memory defaults preserve existing cloud and custom daemon connection semantics', async () => {
  for (const connection of [{ serverMode: 'cloud' }, { serverMode: 'daemon', apiPort: 9000 }]) {
    const f = fixture();
    try {
      writeFileSync(f.memory, JSON.stringify(connection));
      const result = await run(f, 'memory'); assert.equal(result.code, 0, result.stderr);
      const cfg = JSON.parse(readFileSync(f.memory, 'utf8'));
      assert.equal(cfg.serverMode, connection.serverMode);
      assert.equal(Object.hasOwn(cfg, 'apiUrl'), false, 'do not inject localhost over implied connection');
      assert.equal(cfg.apiPort, connection.apiPort);
    } finally { f.cleanup(); }
  }
});

test('existing implicit and nested cloud settings retain connections and enroll the effective opt-in list', async () => {
  for (const original of [
    { apiToken: 'fixture-implicit-token' },
    { optInPaths: ['C:/existing-top'], harnesses: { opencode: { serverMode: 'cloud', optInOnly: true, optInPaths: ['C:/existing-nested'] } } },
  ]) {
    const f = fixture();
    try {
      writeFileSync(f.memory, JSON.stringify(original));
      const result = await run(f, 'memory'); assert.equal(result.code, 0, result.stderr);
      const cfg = JSON.parse(readFileSync(f.memory, 'utf8'));
      for (const key of ['serverMode', 'apiUrl', 'apiPort']) assert.equal(Object.hasOwn(cfg, key), false);
      if (original.apiToken) assert.equal(cfg.apiToken, original.apiToken);
      else {
        assert.deepEqual(cfg.optInPaths, original.optInPaths);
        assert.equal(cfg.harnesses.opencode.serverMode, 'cloud');
        assert.equal(Object.hasOwn(cfg.harnesses.opencode, 'apiUrl'), false);
        assert.ok(cfg.harnesses.opencode.optInPaths.includes('C:/existing-nested'));
        assert.ok(cfg.harnesses.opencode.optInPaths.some(value => path.resolve(value) === path.resolve(f.repo)));
      }
    } finally { f.cleanup(); }
  }
});

test('first-time memory settings use repository opt-in instead of example paths', async () => {
  const f = fixture();
  try {
    const result = await run(f, 'memory'); assert.equal(result.code, 0, result.stderr);
    const cfg = JSON.parse(readFileSync(f.memory, 'utf8'));
    assert.equal(cfg.optInOnly, true); assert.equal(cfg.retainSessions, true);
    assert.equal(cfg.autoUpdate, false); assert.equal(cfg.optInPaths.length, 1);
    assert.equal(path.resolve(cfg.optInPaths[0]), path.resolve(f.repo));
  } finally { f.cleanup(); }
});

test('memory opt-in preserves existing connection and authentication without leaking secrets', async () => {
  const f = fixture();
  try {
    const original = { apiUrl: 'https://existing.example', apiToken: 'fixture-memory-secret', serverMode: 'cloud', optInPaths: ['C:/another-project'], banks: { private: { bank: 'alias' } } };
    writeFileSync(f.memory, JSON.stringify(original));
    const result = await run(f, 'memory'); assert.equal(result.code, 0, result.stderr);
    const cfg = JSON.parse(readFileSync(f.memory, 'utf8'));
    assert.equal(cfg.apiUrl, original.apiUrl); assert.equal(cfg.apiToken, original.apiToken);
    assert.equal(cfg.serverMode, 'cloud'); assert.deepEqual(cfg.banks, original.banks);
    assert.ok(cfg.optInPaths.includes('C:/another-project'));
    assert.ok(cfg.optInPaths.some(value => path.resolve(value) === path.resolve(f.repo)));
    assert.ok(!result.stdout.includes(original.apiToken) && !result.stderr.includes(original.apiToken));
    const info = await run(f, 'memory-info'); assert.equal(info.code, 0, info.stderr);
    const parsed = JSON.parse(info.stdout); assert.deepEqual(Object.keys(parsed).sort(), ['enabled', 'localBootstrap', 'reachable']);
    assert.equal(parsed.localBootstrap, false);
  } finally { f.cleanup(); }
});

test('malformed memory config is preserved', async () => {
  const f = fixture();
  try { writeFileSync(f.memory, '{ invalid'); assert.notEqual((await run(f, 'memory')).code, 0); assert.equal(readFileSync(f.memory, 'utf8'), '{ invalid'); }
  finally { f.cleanup(); }
});

test('memory check authenticates health and bank requests, initializes a missing bank, and rejects error payloads', async () => {
  const f = fixture(), requests = []; let rejectStats = false, created = false;
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== 'Bearer fixture-api-secret') { response.statusCode = 401; response.end('{"error":"unauthorized"}'); return; }
    if (request.url === '/health') { response.end('{"status":"healthy","database":"connected"}'); return; }
    if (request.method === 'PUT') { created = true; response.end('{}'); return; }
    if (request.url.endsWith('/stats')) {
      if (!created) { response.statusCode = 404; response.end('{"detail":"not found"}'); }
      else response.end(rejectStats ? '{"error":"failed"}' : '{"total_memories":0}');
      return;
    }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    writeFileSync(f.memory, JSON.stringify({ serverMode: 'self-hosted', apiUrl: `http://127.0.0.1:${server.address().port}`, apiToken: 'fixture-api-secret', bankId: 'test-bank' }));
    const result = await run(f, 'memory-check'); assert.equal(result.code, 0, result.stderr);
    assert.ok(created); assert.ok(requests.some(item => item.url === '/health'));
    assert.ok(requests.every(item => item.authorization === 'Bearer fixture-api-secret'));
    assert.ok(!result.stdout.includes('fixture-api-secret') && !result.stderr.includes('fixture-api-secret'));
    rejectStats = true;
    assert.notEqual((await run(f, 'memory-check')).code, 0, 'HTTP 200 error payload is not healthy');
  } finally { await new Promise(resolve => server.close(resolve)); f.cleanup(); }
});

test('PowerShell opt-out and pending memory preserve core installation', { skip: process.platform !== 'win32' }, async () => {
  for (const scenario of ['N', 'Y', 'pending']) {
    const f = fixture();
    try {
      mkdirSync(path.join(f.repo, 'tools/opencode-harness'), { recursive: true });
      mkdirSync(path.join(f.repo, 'docs'), { recursive: true });
      writeFileSync(path.join(f.repo, 'docs/index.md'), '# Context');
      writeFileSync(path.join(f.repo, 'tools/opencode-harness/policy.json'), JSON.stringify({ documentationIndex: 'docs/index.md', documentationRoutes: [] }));
      writeFileSync(f.memory, JSON.stringify({ apiToken: 'fixture-preserved-secret', apiUrl: 'https://existing.example' }));
      const script = path.join(f.root, 'mock-setup.ps1');
      writeFileSync(script, [
        '. $env:TEST_SETUP_SCRIPT',
        '$script:calls = [Collections.Generic.List[string]]::new()',
        'function Show-SetupHostWarning { }',
        'function Install-SetupPrerequisite { }',
        "function Enable-SetupBackground { $script:calls.Add('background') }",
        'function Get-SetupConfigDirectory { $env:TEST_CONFIG }',
        "function Start-SetupGraphWatcher { $script:calls.Add('watcher') }",
        "function Install-SetupWslMemory { $script:calls.Add('wsl'); if ($env:TEST_SCENARIO -eq 'pending') { throw 'mock pending' } }",
        'function Invoke-SetupNative([string]$Command, [string[]]$Arguments) {',
        "  $script:calls.Add(($Command + ' ' + ($Arguments -join ' ')))",
        "  if ($Command -eq 'git.exe') { if ($Arguments -contains '--show-toplevel') { return $env:TEST_REPO }; return 'mock-head' }",
        "  if ($Command -eq 'node.exe') {",
        "    if ($Arguments[0] -eq '--version') { return 'v24.15.0' }",
        '    if ($Arguments[1] -eq \'memory-info\') { return \'{"reachable":false,"localBootstrap":true,"enabled":true}\' }',
        "    if ($Arguments[1] -eq 'memory-check') { return }",
        '    & $env:TEST_NODE @Arguments',
        "    if ($LASTEXITCODE -ne 0) { throw 'mock helper failed' }; return",
        '  }',
        "  if ($Command -eq 'npx.cmd') {",
        "    $file = Join-Path $env:TEST_CONFIG 'opencode.json'",
        '    $config = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json',
        "    $config | Add-Member -NotePropertyName plugin -NotePropertyValue @('file:///C:/Users/test/.hindsight/coding-agents/dist/opencode.js') -Force",
        '    $config | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $file',
        '  }',
        '}',
        "$choice = if ($env:TEST_SCENARIO -eq 'N') { 'N' } else { 'Y' }",
        '$code = Start-HarnessSetup $env:TEST_REPO $choice',
        '@{ code = $code; calls = @($script:calls) } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $env:TEST_RESULT',
      ].join('\n'));
      const result = path.join(f.root, 'result.json');
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, HINDSIGHT_CONFIG: f.memory, TEST_SETUP_SCRIPT: fileURLToPath(new URL('../setup.ps1', import.meta.url)), TEST_REPO: f.repo, TEST_CONFIG: f.config, TEST_NODE: process.execPath, TEST_SCENARIO: scenario, TEST_RESULT: result }, stdio: 'pipe' });
      const report = JSON.parse(readFileSync(result, 'utf8').replace(/^\uFEFF/, ''));
      assert.equal(report.code, scenario === 'pending' ? 2 : 0);
      assert.ok(readdirSync(path.join(f.config, 'plugins')).includes('sdlc.js'));
      assert.ok(report.calls.includes('background'));
      assert.equal(report.calls.some(call => call.startsWith('npx.cmd')), scenario !== 'N');
      assert.equal(report.calls.includes('wsl'), scenario !== 'N');
      assert.equal(JSON.parse(readFileSync(f.memory, 'utf8')).apiToken, 'fixture-preserved-secret');
      if (scenario === 'N') assert.ok(!report.calls.some(call => call.includes('memory')));
    } finally { f.cleanup(); }
  }
});

test('setup host detection warns with PIDs and continues without stopping hosts', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    const script = path.join(f.root, 'mock-hosts.ps1');
    writeFileSync(script, [
      '. $env:TEST_SETUP_SCRIPT',
      'function Get-Process { if ($env:TEST_SCENARIO -eq \'running\') { [pscustomobject]@{ Id = 456 }; [pscustomobject]@{ Id = 123 } } }',
      "function Stop-Process { throw 'Setup must not stop a host' }",
      '$warnings = @(Show-SetupHostWarning 3>&1)',
      '@{ continued = $true; warnings = @($warnings | ForEach-Object { $_.ToString() }) } | ConvertTo-Json | Set-Content -LiteralPath $env:TEST_RESULT',
    ].join('\n'));
    for (const scenario of ['closed', 'running']) {
      const result = path.join(f.root, scenario + '.json');
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, TEST_SETUP_SCRIPT: fileURLToPath(new URL('../setup.ps1', import.meta.url)), TEST_SCENARIO: scenario, TEST_RESULT: result }, stdio: 'pipe' });
      const report = JSON.parse(readFileSync(result, 'utf8').replace(/^\uFEFF/, ''));
      assert.equal(report.continued, true);
      assert.equal(report.warnings.length, scenario === 'running' ? 1 : 0);
      if (scenario === 'running') {
        assert.match(report.warnings[0], /PIDs: 123, 456/);
        assert.match(report.warnings[0], /Setup will continue without stopping them/);
        assert.match(report.warnings[0], /fully exit\/restart OpenCode after setup/);
      }
    }
  } finally { f.cleanup(); }
});

test('graph watcher requires observed readiness without spawning processes in tests', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    const script = path.join(f.root, 'mock-watcher.ps1');
    writeFileSync(script, [
      '. $env:TEST_SETUP_SCRIPT',
      '$script:statusCalls = 0; $script:launches = 0',
      "function Get-Command { [pscustomobject]@{ Source = 'fixture-uvx.exe' } }",
      'function Start-Sleep { }',
      'function Start-Process { $script:launches++; [pscustomobject]@{ HasExited = $false } }',
      'function Invoke-SetupNative {',
      '  $script:statusCalls++',
      "  if ($env:TEST_SCENARIO -eq 'ready' -and $script:statusCalls -gt 1) { return 'Daemon: running' }",
      "  return 'Daemon: not running'",
      '}',
      '$failed = $false',
      'try { Start-SetupGraphWatcher } catch { $failed = $true }',
      '@{ failed = $failed; launches = $script:launches; statusCalls = $script:statusCalls } | ConvertTo-Json | Set-Content -LiteralPath $env:TEST_RESULT',
    ].join('\n'));
    for (const scenario of ['ready', 'failed']) {
      const result = path.join(f.root, scenario + '.json');
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, TEST_SETUP_SCRIPT: fileURLToPath(new URL('../setup.ps1', import.meta.url)), TEST_SCENARIO: scenario, TEST_RESULT: result }, stdio: 'pipe' });
      const report = JSON.parse(readFileSync(result, 'utf8').replace(/^\uFEFF/, ''));
      assert.equal(report.failed, scenario === 'failed');
      assert.equal(report.launches, 1);
      assert.equal(report.statusCalls, scenario === 'ready' ? 2 : 4);
    }
  } finally { f.cleanup(); }
});
