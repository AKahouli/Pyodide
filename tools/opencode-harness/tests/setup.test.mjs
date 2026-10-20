import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const config = path.join(root, 'config'), repo = path.join(root, 'project'), backup = path.join(root, 'backup');
  mkdirSync(config); mkdirSync(repo); mkdirSync(backup);
  execFileSync('git', ['init', '-q', repo]);
  const link = path.join(config, 'node_modules');
  symlinkSync(path.join(sdk, 'node_modules'), link, process.platform === 'win32' ? 'junction' : 'dir');
  return { root, config, repo, backup, cleanup() { unlinkSync(link); rmSync(root, { recursive: true, force: true }); } };
}
function run(f, action, extra = {}) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('HINDSIGHT_')));
    const child = spawn(process.execPath, [helper, action, f.config, f.repo, f.backup], { env: { ...env, ...extra }, windowsHide: true });
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
    assert.deepEqual(cfg.provider.custom, jsonc.parse(original).provider.custom);
    for (const model of Object.values(cfg.provider.openai.models)) {
      assert.equal(model.limit.input - cfg.compaction.reserved, 400000);
      assert.ok(model.limit.input + model.limit.output <= model.limit.context);
    }
    assert.equal(cfg.model, 'custom/model'); assert.deepEqual(cfg.plugin, ['personal-plugin']);
    assert.equal(cfg.permission.bash, 'ask'); assert.equal(cfg.mcp.context7.enabled, false);
    assert.equal(cfg.mcp['code-review-graph'], undefined, 'code-review-graph MCP must not be reintroduced');
    assert.equal(cfg.mcp['chrome-devtools'].enabled, true);
    assert.equal(cfg.compaction.auto, true);
    assert.equal(cfg.agent.build.permission.skill['graphify-navigation'], 'allow');
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

test('unknown setup actions are rejected', async () => {
  const f = fixture();
  try {
    for (const action of ['memory', 'memory-info', 'memory-check', 'memory-policy', 'memory-registration']) {
      assert.notEqual((await run(f, action)).code, 0, action);
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

test('core installation survives graphify pending and preserves core files', { skip: process.platform !== 'win32' }, async () => {
  for (const scenario of ['ok', 'pending']) {
    const f = fixture();
    try {
      mkdirSync(path.join(f.repo, 'tools/opencode-harness'), { recursive: true });
      mkdirSync(path.join(f.repo, 'docs'), { recursive: true });
      writeFileSync(path.join(f.repo, 'docs/index.md'), '# Context');
      writeFileSync(path.join(f.repo, 'tools/opencode-harness/policy.json'), JSON.stringify({ documentationIndex: 'docs/index.md', documentationRoutes: [] }));
      const script = path.join(f.root, 'mock-setup.ps1');
      writeFileSync(script, [
        '. $env:TEST_SETUP_SCRIPT',
        '$script:calls = [Collections.Generic.List[string]]::new()',
        'function Show-SetupHostWarning { }',
        'function Install-SetupPrerequisite { }',
        "function Enable-SetupBackground { $script:calls.Add('background') }",
        'function Get-SetupConfigDirectory { $env:TEST_CONFIG }',
        "function Install-SetupGraphify { $script:calls.Add('graphify'); if ($env:TEST_SCENARIO -eq 'pending') { throw 'mock pending' } }",
        'function Invoke-SetupNative([string]$Command, [string[]]$Arguments) {',
        "  $script:calls.Add(($Command + ' ' + ($Arguments -join ' ')))",
        "  if ($Command -eq 'git.exe') { if ($Arguments -contains '--show-toplevel') { return $env:TEST_REPO }; return 'mock-head' }",
        "  if ($Command -eq 'node.exe') {",
        "    if ($Arguments[0] -eq '--version') { return 'v24.15.0' }",
        '    & $env:TEST_NODE @Arguments',
        "    if ($LASTEXITCODE -ne 0) { throw 'mock helper failed' }; return",
        '  }',
        '}',
        '$code = Start-HarnessSetup $env:TEST_REPO',
        '@{ code = $code; calls = @($script:calls) } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $env:TEST_RESULT',
      ].join('\n'));
      const result = path.join(f.root, 'result.json');
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, TEST_SETUP_SCRIPT: fileURLToPath(new URL('../setup.ps1', import.meta.url)), TEST_REPO: f.repo, TEST_CONFIG: f.config, TEST_NODE: process.execPath, TEST_SCENARIO: scenario, TEST_RESULT: result }, stdio: 'pipe' });
      const report = JSON.parse(readFileSync(result, 'utf8').replace(/^\uFEFF/, ''));
      assert.equal(report.code, scenario === 'pending' ? 2 : 0);
      assert.ok(readdirSync(path.join(f.config, 'plugins')).includes('sdlc.js'));
      assert.ok(report.calls.includes('background'));
      assert.ok(report.calls.includes('graphify'));
      assert.equal(readdirSync(path.join(f.config, 'agents')).includes('frontend-qa.md'), true);
      assert.equal(readdirSync(path.join(f.config, 'skills')).includes('graphify-navigation'), true);
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

test('graphify hooks require observed installed status and skip extraction when a graph exists', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.repo, 'graphify-out'));
    writeFileSync(path.join(f.repo, 'graphify-out/graph.json'), '{"graph":{"schema_version":1},"nodes":[{}]}');
    const script = path.join(f.root, 'mock-hook.ps1');
    writeFileSync(script, [
      '. $env:TEST_SETUP_SCRIPT',
      '$script:commands = [Collections.Generic.List[string]]::new()',
      "function Get-Command { [CmdletBinding()] param([string]$Name); if ($Name -eq 'graphify.exe' -and ($env:TEST_SCENARIO -ne 'missing' -or $script:commands.Contains('uv.exe tool install graphifyy'))) { [pscustomobject]@{ Source = 'fixture-graphify.exe' } } }",
      'function Invoke-SetupNative([string]$Command, [string[]]$Arguments) {',
      '  $script:commands.Add(($Command + \' \' + ($Arguments -join \' \')))',
      "  if ($Arguments[0] -eq 'hook' -and $Arguments[1] -eq 'status') {",
      "    if ($env:TEST_SCENARIO -eq 'partial') { return @('post-commit: installed', 'post-checkout: missing') }",
      "    return @('post-commit: installed', 'post-checkout: installed', 'post-merge: installed', 'post-rewrite: installed', 'merge driver: registered')",
      '  }',
      '  return',
      '}',
      '$failed = $false',
      'try { Install-SetupGraphify $env:TEST_REPO } catch { $failed = $true }',
      '@{ failed = $failed; commands = @($script:commands) } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $env:TEST_RESULT',
    ].join('\n'));
    const expected = {
      installed: { failed: false },
      missing: { failed: false },
      partial: { failed: true },
    };
    for (const scenario of ['installed', 'missing', 'partial']) {
      const result = path.join(f.root, scenario + '.json');
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, TEST_SETUP_SCRIPT: fileURLToPath(new URL('../setup.ps1', import.meta.url)), TEST_REPO: f.repo, TEST_SCENARIO: scenario, TEST_RESULT: result }, stdio: 'pipe' });
      const report = JSON.parse(readFileSync(result, 'utf8').replace(/^\uFEFF/, ''));
      assert.equal(report.failed, expected[scenario].failed, scenario);
      assert.ok(report.commands.some(call => call === 'fixture-graphify.exe hook install'), JSON.stringify(report.commands));
      assert.ok(report.commands.some(call => call === 'fixture-graphify.exe hook status'), JSON.stringify(report.commands));
      assert.equal(report.commands.some(call => call.includes('extract')), false, 'existing graph must not be re-extracted');
      // A working graphify install is never reinstalled (the running tool's
      // files are locked while hooks may be executing it).
      assert.equal(report.commands.some(call => call.startsWith('uv.exe tool install')), scenario === 'missing', JSON.stringify(report.commands));
    }
  } finally { f.cleanup(); }
});

test('prerequisite install refreshes PATH and tolerates an already-installed package', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    const script = path.join(f.root, 'mock-prerequisite.ps1');
    writeFileSync(script, [
      '. $env:TEST_SETUP_SCRIPT',
      '$script:wingetCalls = 0; $script:refreshed = 0',
      'function Update-SetupPath { $script:refreshed++ }',
      'function Get-Command {',
      '  [CmdletBinding()] param([string]$Name)',
      "  if ($Name -eq 'winget.exe') { return [pscustomobject]@{ Source = 'winget.exe' } }",
      "  $needed = if ($env:TEST_SCENARIO -eq 'loaded') { 1 } elseif ($env:TEST_SCENARIO -eq 'installed') { 2 } else { 99 }",
      '  if ($script:refreshed -ge $needed) { return [pscustomobject]@{ Source = $Name } }',
      '  return $null',
      '}',
      'function Invoke-SetupNative([string]$Command, [string[]]$Arguments) {',
      "  if ($Command -eq 'winget.exe') { $script:wingetCalls++; throw 'winget.exe failed (exit -1978335189).' }",
      '}',
      '$failed = $false',
      "try { Install-SetupPrerequisite 'uvx.exe' 'astral-sh.uv' } catch { $failed = $true }",
      '@{ failed = $failed; wingetCalls = $script:wingetCalls; refreshed = $script:refreshed } | ConvertTo-Json | Set-Content -LiteralPath $env:TEST_RESULT',
    ].join('\n'));
    const expected = {
      loaded: { failed: false, wingetCalls: 0, refreshed: 1 },
      installed: { failed: false, wingetCalls: 1, refreshed: 2 },
      missing: { failed: true, wingetCalls: 1, refreshed: 2 },
    };
    for (const scenario of ['loaded', 'installed', 'missing']) {
      const result = path.join(f.root, scenario + '.json');
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, TEST_SETUP_SCRIPT: fileURLToPath(new URL('../setup.ps1', import.meta.url)), TEST_SCENARIO: scenario, TEST_RESULT: result }, stdio: 'pipe' });
      const report = JSON.parse(readFileSync(result, 'utf8').replace(/^\uFEFF/, ''));
      assert.deepEqual({ failed: report.failed, wingetCalls: report.wingetCalls, refreshed: report.refreshed }, expected[scenario], scenario);
    }
  } finally { f.cleanup(); }
});
