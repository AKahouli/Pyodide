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
    assert.deepEqual(cfg.provider.custom, jsonc.parse(original).provider.custom);
    for (const model of Object.values(cfg.provider.openai.models)) {
      assert.equal(model.limit.input - cfg.compaction.reserved, 400000);
      assert.ok(model.limit.input + model.limit.output <= model.limit.context);
    }
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

test('memory policy backs up overrides, preserves unrelated settings and is idempotent', async () => {
  const f = fixture(), requests = [], secret = 'fixture-private-memory-token';
  const mission = 'Retain reusable causes and fixes.';
  const desired = { retain_mission: mission, observations_mission: 'Consolidate durable codebase observations.', retain_chunk_size: 8192, recall_max_tokens: 2048, enable_graph_retrieval: false, enable_temporal_retrieval: false };
  let current = { retain_mission: 'old', observations_mission: 'old', retain_chunk_size: 3000, recall_max_tokens: 1000, enable_graph_retrieval: true, enable_temporal_retrieval: true,
    retain_strategies: { conversation: { unrelated: 'keep-conversation' }, documents: { unrelated: 'keep-documents' } }, custom_bank_option: 'keep-bank' };
  let overrides = { custom_override: 'keep-override', retain_strategies: { conversation: { previous_field: 'keep-field' }, custom: { mode: 'keep-strategy' } } };
  const server = createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part;
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== `Bearer ${secret}`) { response.statusCode = 401; response.end('{}'); return; }
    if (request.url === '/openapi.json') { response.end(JSON.stringify({ components: { schemas: { RecallRequest: { properties: { min_scores: { anyOf: [{ $ref: '#/components/schemas/MinScores' }, { type: 'null' }] }, prefer_observations: {}, tags: {}, tags_match: {} } }, MinScores: { properties: { semantic: {}, keyword: {} } } } } })); return; }
    if (request.method === 'PATCH' && request.url.endsWith('/config')) {
      const updates = JSON.parse(body).updates;
      overrides = { ...overrides, ...updates };
      current = { ...current, ...updates };
      response.end('{}'); return;
    }
    if (request.method === 'GET' && request.url.endsWith('/config')) { response.end(JSON.stringify({ bank_id: 'test-bank', config: current, overrides })); return; }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    writeFileSync(f.memory, JSON.stringify({ serverMode: 'self-hosted', apiUrl: `http://127.0.0.1:${server.address().port}`, apiToken: secret, bankId: 'test-bank', defaultBankConfig: desired }));
    const first = await run(f, 'memory-policy'); assert.equal(first.code, 0, first.stderr);
    assert.equal(requests.filter(item => item.method === 'PATCH').length, 1);
    const patch = JSON.parse(requests.find(item => item.method === 'PATCH').body).updates;
    assert.deepEqual(Object.keys(patch).sort(), ['enable_graph_retrieval', 'enable_temporal_retrieval', 'observations_mission', 'recall_max_tokens', 'retain_chunk_size', 'retain_mission', 'retain_strategies']);
    assert.equal(patch.enable_graph_retrieval, false); assert.equal(patch.enable_temporal_retrieval, false);
    assert.equal(patch.retain_chunk_size, 8192); assert.equal(patch.recall_max_tokens, 2048);
    assert.equal(current.custom_bank_option, 'keep-bank'); assert.equal(overrides.custom_override, 'keep-override');
    assert.equal(patch.retain_strategies.documents.unrelated, 'keep-documents');
    assert.equal(patch.retain_strategies.custom.mode, 'keep-strategy');
    assert.equal(patch.retain_strategies.conversation.previous_field, 'keep-field');
    assert.equal(patch.retain_strategies.conversation.unrelated, 'keep-conversation');
    assert.equal(patch.retain_strategies.conversation.retain_extraction_mode, 'concise');
    assert.equal(patch.retain_strategies.conversation.retain_chunk_size, desired.retain_chunk_size);
    const saved = backups(f.backup); assert.equal(saved.length, 1);
    const backup = JSON.parse(readFileSync(path.join(f.backup, saved[0]), 'utf8'));
    assert.equal(backup.config.retain_chunk_size, 3000);
    assert.equal(backup.overrides.custom_override, 'keep-override');
    const second = await run(f, 'memory-policy'); assert.equal(second.code, 0, second.stderr);
    assert.equal(requests.filter(item => item.method === 'PATCH').length, 1);
    assert.equal(backups(f.backup).length, 1);
    for (const result of [first, second]) assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
  } finally { await new Promise(resolve => server.close(resolve)); f.cleanup(); }
});

test('memory policy creates missing bank only on 404 and reports safe failures', async () => {
  const f = fixture(), requests = [], secret = 'fixture-hidden-token';
  const desired = { retain_mission: 'concise fixes', observations_mission: 'durable observations', retain_chunk_size: 12000, recall_max_tokens: 1500, enable_graph_retrieval: false, enable_temporal_retrieval: false };
  let created = false, failPatch = false;
  let current = { ...desired, retain_strategies: { conversation: { retain_mission: 'old' } } };
  const server = createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part;
    requests.push({ method: request.method, url: request.url, body });
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== `Bearer ${secret}`) { response.statusCode = 401; response.end('{}'); return; }
    if (request.url === '/openapi.json') { response.end(JSON.stringify({ components: { schemas: { RecallRequest: { properties: { min_scores: { $ref: '#/components/schemas/MinScores' }, prefer_observations: {}, tags: {}, tags_match: {} } }, MinScores: { properties: { semantic: {}, keyword: {} } } } } })); return; }
    if (request.method === 'PUT') { created = true; assert.equal(body, '{}'); response.end('{}'); return; }
    if (request.method === 'GET' && request.url.endsWith('/config')) {
      if (!created) { response.statusCode = 404; response.end('{}'); return; }
      response.end(JSON.stringify({ config: current, overrides: {} })); return;
    }
    if (request.method === 'PATCH') {
      if (failPatch) { response.statusCode = 500; response.end(JSON.stringify({ error: secret })); return; }
      current = { ...current, ...JSON.parse(body).updates }; response.end('{}'); return;
    }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    writeFileSync(f.memory, JSON.stringify({ serverMode: 'self-hosted', apiUrl: `http://127.0.0.1:${server.address().port}`, apiToken: secret, bankId: 'missing', defaultBankConfig: desired }));
    const initialized = await run(f, 'memory-policy'); assert.equal(initialized.code, 0, initialized.stderr);
    assert.equal(requests.filter(item => item.method === 'PUT').length, 1);
    failPatch = true; current.retain_mission = 'changed-again';
    const failed = await run(f, 'memory-policy'); assert.notEqual(failed.code, 0);
    assert.match(failed.stderr, /Memory policy setup or verification failed/);
    assert.ok(!failed.stdout.includes(secret) && !failed.stderr.includes(secret));
    assert.equal(requests.filter(item => item.method === 'PUT').length, 1);
    assert.equal(backups(f.backup).length, 2, 'each attempted mutation gets a distinct private backup');
  } finally { await new Promise(resolve => server.close(resolve)); f.cleanup(); }
});

test('memory policy rejects unsupported recall API before creating or changing a bank', async () => {
  const f = fixture(), requests = [];
  const desired = { retain_mission: 'fixes', observations_mission: 'observations', retain_chunk_size: 12000, recall_max_tokens: 1500, enable_graph_retrieval: false, enable_temporal_retrieval: false };
  let supported = false;
  let current = { ...desired, retain_strategies: {} };
  const server = createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part;
    requests.push({ method: request.method, url: request.url });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/openapi.json') { response.end(JSON.stringify({ components: { schemas: { RecallRequest: { properties: { min_scores: { $ref: '#/components/schemas/MinScores' }, prefer_observations: {}, tags: {}, tags_match: {} } }, MinScores: { properties: supported ? { semantic: {}, keyword: {} } : { semantic: {} } } } } })); return; }
    if (request.method === 'PATCH') { current = { ...current, ...JSON.parse(body).updates }; response.end('{}'); return; }
    if (request.url.endsWith('/config')) { response.end(JSON.stringify({ config: current, overrides: {} })); return; }
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    writeFileSync(f.memory, JSON.stringify({ serverMode: 'self-hosted', apiUrl: `http://127.0.0.1:${server.address().port}`, bankId: 'test-bank', defaultBankConfig: desired }));
    const unsupportedApi = await run(f, 'memory-policy');
    assert.notEqual(unsupportedApi.code, 0);
    assert.match(unsupportedApi.stderr, /Memory policy requires recall score-filter support/);
    assert.deepEqual(requests.map(item => item.url), ['/openapi.json']);
    assert.equal(backups(f.backup).length, 0);
    supported = true;
    requests.length = 0;
    delete current.enable_graph_retrieval;
    const oldBank = await run(f, 'memory-policy');
    assert.notEqual(oldBank.code, 0);
    assert.match(oldBank.stderr, /Memory policy requires recall score-filter support/);
    assert.ok(!requests.some(item => item.method === 'PATCH' || item.method === 'PUT'));
    assert.equal(backups(f.backup).length, 0);
    current.enable_graph_retrieval = false;
    requests.length = 0;
    const valid = await run(f, 'memory-policy');
    assert.equal(valid.code, 0, valid.stderr);
    assert.ok(requests.some(item => item.method === 'PATCH'));
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
        "    if ($Arguments[1] -in @('memory-policy','memory-check')) { return }",
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
      "  if ($env:TEST_SCENARIO -eq 'running') { return 'Daemon:  running (PID 4242)' }",
      "  if ($env:TEST_SCENARIO -eq 'ready' -and $script:statusCalls -gt 1) { return 'Daemon:  running (PID 4242)' }",
      "  return 'Daemon:  not running'",
      '}',
      '$failed = $false',
      'try { Start-SetupGraphWatcher } catch { $failed = $true }',
      '@{ failed = $failed; launches = $script:launches; statusCalls = $script:statusCalls } | ConvertTo-Json | Set-Content -LiteralPath $env:TEST_RESULT',
    ].join('\n'));
    const expected = {
      running: { failed: false, launches: 0, statusCalls: 1 },
      ready: { failed: false, launches: 1, statusCalls: 2 },
      failed: { failed: true, launches: 1, statusCalls: 4 },
    };
    for (const scenario of ['running', 'ready', 'failed']) {
      const result = path.join(f.root, scenario + '.json');
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, TEST_SETUP_SCRIPT: fileURLToPath(new URL('../setup.ps1', import.meta.url)), TEST_SCENARIO: scenario, TEST_RESULT: result }, stdio: 'pipe' });
      const report = JSON.parse(readFileSync(result, 'utf8').replace(/^\uFEFF/, ''));
      assert.equal(report.failed, expected[scenario].failed, scenario);
      assert.equal(report.launches, expected[scenario].launches, scenario);
      assert.equal(report.statusCalls, expected[scenario].statusCalls, scenario);
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

test('WSL memory install converts the script path with exec semantics', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    const script = path.join(f.root, 'mock-wsl.ps1');
    writeFileSync(script, [
      '. $env:TEST_SETUP_SCRIPT',
      '$global:LASTEXITCODE = 0',
      '$script:calls = [Collections.Generic.List[object]]::new()',
      "function wsl.exe { return $env:TEST_DISTRIBUTION }",
      'function Invoke-SetupNative([string]$Command, [string[]]$Arguments) {',
      '  $script:calls.Add([pscustomobject]@{ command = $Command; arguments = $Arguments })',
      "  if ($Arguments -contains 'wslpath') { return '/mnt/c/tmp/harness-script.sh' }",
      '  return',
      '}',
      "Install-SetupWslMemory 'Ubuntu-22.04'",
      '@{ calls = @($script:calls | ForEach-Object { $_.command + " " + ($_.arguments -join " ") }) } | ConvertTo-Json | Set-Content -LiteralPath $env:TEST_RESULT',
    ].join('\n'));
    const result = path.join(f.root, 'wsl.json');
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, TEST_SETUP_SCRIPT: fileURLToPath(new URL('../setup.ps1', import.meta.url)), TEST_DISTRIBUTION: 'Ubuntu-22.04', TEST_RESULT: result }, stdio: 'pipe' });
    const calls = JSON.parse(readFileSync(result, 'utf8').replace(/^\uFEFF/, '')).calls;
    assert.ok(calls.some(call => call.startsWith('wsl.exe -d Ubuntu-22.04 -e wslpath -a -u ')), JSON.stringify(calls));
    assert.ok(calls.some(call => call === 'wsl.exe -d Ubuntu-22.04 -e bash /mnt/c/tmp/harness-script.sh'), JSON.stringify(calls));
    assert.ok(calls.every(call => !call.includes(' -- ')), 'path conversion must bypass the default shell: ' + JSON.stringify(calls));
  } finally { f.cleanup(); }
});
