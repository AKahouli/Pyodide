#!/usr/bin/env node
/** PR06 isolated existing-component supervisor. No installs, migrations or live DB reads.
 * node scripts/pr06-local-stack.mjs --check
 * node scripts/pr06-local-stack.mjs --list-models
 * node scripts/pr06-local-stack.mjs --start-stack --python C:/.../envs/meta/python.exe --model PROVIDER_MODEL_ID
 * Optional --redis-image EXISTING_IMAGE (default redis:7-alpine; never pulled).
 * Optional --conversation-api chat_completions|responses (default chat_completions).
 * Ctrl+C stops only this supervisor's children and its exact created Redis ID.
 * Fixture rows remain in dedicated PG for inspection; primary owns PG cleanup.
 * ADR-0027: no SSE timing, auth/session guard, admission or transport substitutions.
 * Provenance: postgres/schema/{identity,catalog,agents}.schema.ts; AuthService.login;
 * ConversationController.create; agent.service.ts resolveRootForConversation;
 * ADK config/settings.py, main.py, routers/health.py, grpc_server/credentials.py.
 * Source-only implementation: primary must run syntax/preflight/runtime checks.
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { readFile, mkdir, writeFile, access, appendFile, cp } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'YellowStorm', 'back');
const adk = path.join(root, 'yellowstorm-adk');
const requireBackend = createRequire(path.join(backend, 'package.json'));
const exec = promisify(execFile);
const pgConfig = Object.freeze({ host: '127.0.0.1', port: 55526, database: 'agentstore_test',
  user: 'postgres', password: 'pr06-test-only', connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const providerKeys = new Set(['LITELLM_API_URL', 'LITELLM_API_KEY', 'LITELLM_API_BASE_URL',
  'LITELLM_API_SECRET_KEY', 'LITELLM_TIMEOUT_MS', 'OLLAMA_API_BASE_URL', 'OLLAMA_API_KEY',
  'EMBEDDING_MODEL', 'EMBEDDING_DIMENSION']);
const children = [], logs = [], secrets = new Set([pgConfig.password]);
let runDirectory, record, redisId, redisCreation, provisioning, stopping = false, stage = 'arguments', stopPromise;
const shutdown = new AbortController();
const secret = () => { const value = randomBytes(32).toString('hex'); secrets.add(value); return value; };
const objectId = () => randomBytes(12).toString('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function fail(code) { const error = new Error(code); error.safeCode = code; throw error; }
function active() { if (stopping) fail('supervisor_stopping'); }

/** Keep the entire inspection/acquisition registered with shutdown, not just create. */
export async function acquireRedis(command, args, cancelled, acquired) {
  if (cancelled()) throw new Error('supervisor_stopping');
  await command('docker', ['image', 'inspect', args.image]);
  if (cancelled()) throw new Error('supervisor_stopping');
  const result = await command('docker', args.create);
  const id = result.stdout.trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('unexpected_created_container_id');
  await acquired(id); // Record ownership even if cancellation raced create.
  return id;
}
function minimalEnvironment() {
  const result = {};
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP']) {
    if (process.env[key]) result[key] = process.env[key];
  }
  return result; // No NODE_OPTIONS, Python config, proxies or application env inherited.
}
function remember(env) {
  for (const [key, value] of Object.entries(env)) {
    if (/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key) && value?.length >= 8) secrets.add(value);
  }
}
function redact(text) {
  let result = String(text);
  for (const value of [...secrets].sort((a, b) => b.length - a.length)) result = result.split(value).join('[redacted]');
  return result.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt-redacted]')
    .replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/(postgres(?:ql)?(?:\+\w+)?:\/\/)[^\s"']+/gi, '$1[redacted]');
}
async function save() {
  if (record) await writeFile(path.join(runDirectory, 'ownership.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
}
async function privateJson(name, value) {
  await writeFile(path.join(runDirectory, name), JSON.stringify(value, null, 2), { mode: 0o600 });
}
function capture(child, role) {
  const filename = path.join(runDirectory, `${role}.log`);
  let queue = Promise.resolve();
  const enqueue = text => { queue = queue.then(() => appendFile(filename, redact(text), { mode: 0o600 })); queue.catch(() => {}); };
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '', dropping = false;
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline + 1); pending = pending.slice(newline + 1);
        if (!dropping && line.length < 65536) enqueue(line);
        else enqueue('[oversized log line omitted]\n');
        dropping = false;
      }
      // Do not flush a partial secret across a truncation boundary.
      if (pending.length > 65536) { pending = ''; dropping = true; }
    });
    stream.on('end', () => { if (pending && !dropping) enqueue(`${pending}\n`); });
  }
  logs.push(() => queue);
  return filename;
}
function launch(role, executable, args, env, port) {
  if (stopping) fail('supervisor_stopping');
  remember(env);
  const child = spawn(executable, args, { cwd: runDirectory, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.push(child);
  const log = capture(child, role);
  const item = { role, port, pid: child.pid ?? null, log, status: 'spawned' };
  record.processes.push(item);
  child.once('error', () => { item.status = 'spawn_failed'; process.exitCode = 1; void stop(); });
  child.once('exit', (code, signal) => {
    item.status = 'exited'; item.exitCode = code; item.signal = signal;
    if (!stopping) { process.exitCode = 1; record.failure = `${role}_unexpected_exit`; void stop(); }
  });
  return child;
}
async function command(executable, args, env = minimalEnvironment()) {
  // Never inherit the app env into Docker or Python utility processes.
  try { return await exec(executable, args, { cwd: runDirectory ?? root, env, timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true }); }
  catch (error) {
    if (runDirectory) await appendFile(path.join(runDirectory, 'bootstrap.log'), redact(`${stage}: ${error.stderr ?? error.message}\n`), { mode: 0o600 });
    fail(`${stage}_command_failed`);
  }
}
async function providerConfiguration() {
  const { parse } = requireBackend('dotenv');
  const values = {}, provenance = [];
  let connection;
  for (const relative of ['YellowStorm/back/.env', 'yellowstorm-adk/.env']) {
    let contents;
    try { contents = await readFile(path.join(root, relative), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const parsed = parse(contents);
    // Select URL and key atomically from the same file/name family.
    if (!connection) {
      for (const [urlKey, keyKey] of [['LITELLM_API_URL', 'LITELLM_API_KEY'], ['LITELLM_API_BASE_URL', 'LITELLM_API_SECRET_KEY']]) {
        if (parsed[urlKey] && parsed[keyKey]) {
          connection = { url: parsed[urlKey], key: parsed[keyKey] };
          provenance.push({ file: relative, connectionFields: [urlKey, keyKey] });
          break;
        }
      }
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (providerKeys.has(key) && value && values[key] === undefined) {
        values[key] = value; provenance.push({ file: relative, field: key });
      }
    }
  }
  if (!connection) fail('provider_url_and_key_required');
  values.LITELLM_API_URL = connection.url;
  values.LITELLM_API_KEY = connection.key;
  values.LITELLM_API_BASE_URL = values.LITELLM_API_URL;
  values.LITELLM_API_SECRET_KEY = values.LITELLM_API_KEY;
  for (const key of Object.keys(values)) if (values[key] === undefined) delete values[key];
  remember(values);
  for (const value of Object.values(values)) if (value.length >= 8) secrets.add(value);
  return { values, provenance };
}
async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(Object.assign(new Error(), { safeCode: `port_${port}_not_free` })));
    server.listen({ port, exclusive: true }, () => server.close(resolve));
  });
}
async function withDb(action) {
  const client = new (requireBackend('pg').Client)(pgConfig);
  try { await client.connect(); return await action(client); } finally { await client.end(); }
}
async function databasePreflight() {
  await withDb(async client => {
    const { rows } = await client.query("SELECT current_database() AS db, to_regclass('conversation.sse_events')::text AS sse");
    if (rows[0]?.db !== 'agentstore_test' || !rows[0]?.sse) fail('dedicated_pg_or_sse_migration_missing');
  });
}
async function httpJson(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(15000)]) });
  let body;
  try { body = await response.json(); } catch { body = null; }
  return { response, body: body?.data ?? body };
}
async function ready(url, predicate = () => true) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !stopping) {
    try { const { response, body } = await httpJson(url); if (response.ok && predicate(body)) return; } catch { /* bounded startup retry */ }
    await sleep(1000);
  }
  fail('http_readiness_timeout');
}
async function stop() {
  if (stopPromise) return stopPromise;
  stopping = true;
  shutdown.abort();
  stopPromise = (async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? undefined : new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    })));
    if (provisioning) await provisioning.catch(() => {});
    // Entire Redis inspection/acquisition is registered before its first await.
    if (redisCreation) await redisCreation.catch(() => {});
    if (redisId) {
      // In-memory ID returned by our docker create; never accept a user PID/name.
      try { await command('docker', ['rm', '-f', redisId]); } catch { if (record) record.redisCleanup = 'failed_primary_must_inspect_owned_id'; }
    }
    await Promise.allSettled(logs.map(flush => flush()));
    if (record) { record.status = 'stopped'; await save(); }
  })();
  return stopPromise;
}
function options() {
  const [mode, ...args] = process.argv.slice(2), result = { mode, api: 'chat_completions', image: 'redis:7-alpine' };
  if (!['--check', '--list-models', '--start-backends', '--start-stack'].includes(mode)) fail('usage_check_list_models_start_backends_or_start_stack');
  const names = { '--python': 'python', '--model': 'model', '--redis-image': 'image', '--conversation-api': 'api' };
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) fail('invalid_option');
    result[names[args[i]]] = args[i + 1];
  }
  if (!['chat_completions', 'responses'].includes(result.api)) fail('invalid_conversation_api');
  if (mode === '--start-stack' && (!result.python || !path.isAbsolute(result.python) || !result.model || !/^[A-Za-z0-9_.:/-]{1,100}$/.test(result.model))) fail('absolute_python_and_explicit_model_required');
  return result;
}
async function listModels(provider) {
  const url = new URL(provider.LITELLM_API_URL.replace(/\/$/, '') + '/v1/models');
  const { response, body } = await httpJson(url, { headers: { Authorization: `Bearer ${provider.LITELLM_API_KEY}` } });
  if (!response.ok) fail('provider_model_listing_failed');
  // httpJson unwraps data; emit only bounded model identifiers, never raw bodies.
  console.log(JSON.stringify({ models: (Array.isArray(body) ? body : []).map(row => row.id)
    .filter(id => typeof id === 'string' && /^[A-Za-z0-9_.:/-]{1,100}$/.test(id)).slice(0, 500) }));
}
async function provisionBase(model, api) {
  const planId = objectId(), monoTypeId = objectId();
  let modelRowId = objectId();
  const identities = Array.from({ length: 30 }, (_, i) => ({ userId: objectId(), agentId: objectId(),
    email: `pr06-${path.basename(runDirectory)}-${i}@example.invalid`, password: secret(), tokenEnv: `PR06_TOKEN_${i + 1}` }));
  const bcrypt = requireBackend('bcrypt');
  const hashes = await Promise.all(identities.map(identity => bcrypt.hash(identity.password, 12)));
  active();
  for (const hash of hashes) secrets.add(hash);
  await withDb(async client => {
    await client.query('BEGIN');
    try {
      // Exact schema source above. All records newly generated in owned PG only.
      await client.query(`INSERT INTO catalog.plans(id,name,slug,token_limit,max_tokens_per_request,requests_per_minute)
        VALUES($1,$2,$3,-1,-1,120)`, [planId, `PR06 ${planId}`, `pr06-${planId}`]);
      // An earlier run/backend sync can have this provider model in OWNED PG.
      // Reuse only its catalog identifier after validating explicit API choice;
      // never overwrite it or copy live users/agents/conversations/connectors.
      await client.query(`INSERT INTO catalog.ai_models(id,model_id,name,chef,chef_slug,litellm_model,type,types,conversation_api)
        VALUES($1,$2,$2,'PR06 explicit caller input','pr06',$2,'chat',ARRAY['chat'],$3)
        ON CONFLICT(model_id) DO NOTHING`, [modelRowId, model, api]);
      const selectedModel = (await client.query('SELECT id,conversation_api,is_active FROM catalog.ai_models WHERE model_id=$1', [model])).rows[0];
      if (!selectedModel?.is_active || selectedModel.conversation_api !== api) fail('owned_model_catalog_conflicts_with_explicit_metadata');
      modelRowId = selectedModel.id;
      // A run-owned eligible type; the canonical slug is required by production root resolution.
      const existing = await client.query("SELECT id FROM catalog.agent_types WHERE slug='mono-agent'");
      const typeId = existing.rows[0]?.id ?? monoTypeId;
      if (!existing.rowCount) await client.query("INSERT INTO catalog.agent_types(id,name,slug) VALUES($1,'PR06 Mono Agent','mono-agent')", [typeId]);
      for (const [index, identity] of identities.entries()) {
        active();
        await client.query(`INSERT INTO identity.users(id,email,password_hash,email_verified,status,registration_approval,
          first_name,last_name,profile_complete,plan_id,plan_slug)
          VALUES($1,$2,$3,true,'active','approved','PR06',$4,true,$5,$6)`,
        [identity.userId, identity.email, hashes[index], String(index), planId, `pr06-${planId}`]);
        await client.query(`INSERT INTO public.agents(id,name,slug,role,instruction,agent_type_id,agent_type_slug,created_by,llm_model)
          VALUES($1,'PR06 single agent','pr06-single','Answer the user directly.',
          'Answer briefly in plain text. Do not use tools.',$2,'mono-agent',$3,$4)`,
        [identity.agentId, typeId, identity.userId, model]);
      }
      active();
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
  await privateJson('fixture-seed.json', { provenance: 'new run-owned PostgreSQL rows; no existing user/conversation/connector data',
    schemaSources: ['identity.schema.ts', 'catalog.schema.ts', 'agents.schema.ts'],
    modelProvenance: 'explicit --model and --conversation-api arguments', model, api, planId, modelRowId, monoTypeId, identities });
  return identities;
}
async function authenticateFixtures(identities) {
  const tokens = {};
  for (const [index, identity] of identities.entries()) {
    active();
    const base = `http://127.0.0.1:${3301 + index % 2}/api/v1`;
    stage = `fixture_login_${index + 1}`;
    let login;
    // Honor real auth IP limits; do not disable guards, spoof peers or mint JWTs.
    for (let attempt = 0; attempt < 4; attempt++) {
      login = await httpJson(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identity.email, password: identity.password }) });
      if (login.response.status !== 429) break;
      await sleep(Math.min(120, Math.max(1, Number(login.response.headers.get('retry-after')) || 60)) * 1000);
    }
    if (!login.response.ok || !login.body?.accessToken || login.body?.user?.id !== identity.userId) fail('real_login_failed');
    const token = login.body.accessToken; secrets.add(token); tokens[identity.tokenEnv] = token;
    stage = `fixture_conversation_${index + 1}`;
    const created = await httpJson(`${base}/conversations`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: `PR06 ${index + 1}`, rootAgentId: identity.agentId }) });
    const id = created.body?.id ?? created.body?._id;
    if (created.response.status !== 201 || !/^[a-f0-9]{24}$/.test(id ?? '')) fail('authenticated_conversation_creation_failed');
    identity.conversationId = id;
    // Same production session must authenticate on the other real replica.
    const checked = await httpJson(`http://127.0.0.1:${3302 - index % 2}/api/v1/conversations/${id}`,
      { headers: { Authorization: `Bearer ${token}` } });
    if (!checked.response.ok) fail('cross_replica_session_or_owner_check_failed');
    await privateJson('tokens.json', tokens);
    record.fixtureCount = index + 1; await save();
  }
  return tokens;
}

async function startAdk(config, common) {
  active();
  stage = 'redis_existing_image';
  redisCreation = acquireRedis(command, { image: config.image,
    create: ['create', '--pull=never', '--label', `pr06.owner=${path.basename(runDirectory)}`,
      '--publish', '127.0.0.1:56386:6379', config.image, 'redis-server', '--save', '', '--appendonly', 'no'] },
  () => stopping, async id => {
    redisId = id; record.redisContainerId = id; await save(); return id;
  });
  const id = await redisCreation;
  if (stopping) fail('supervisor_stopping');
  await command('docker', ['start', id]);
  active();
  stage = 'redis_ping';
  let redisReady = false;
  for (let attempt = 0; attempt < 10 && !stopping; attempt++) {
    try { const ping = await command('docker', ['exec', id, 'redis-cli', 'ping']); redisReady = ping.stdout.trim() === 'PONG'; } catch { /* initial Redis startup */ }
    if (redisReady) break;
    await sleep(500);
  }
  if (!redisReady) fail('owned_redis_not_ready');

  stage = 'adk_local_tls';
  // Existing Python cryptography dependency only. Distinct RSA TLS and MCP keys.
  const tlsScript = `from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime, timedelta, timezone
from pathlib import Path
import ipaddress
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])
now=datetime.now(timezone.utc)
c=(x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).sign(k,hashes.SHA256()))
Path('adk-tls.key').write_bytes(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
Path('adk-tls.key').chmod(0o600)
Path('adk-tls.crt').write_bytes(c.public_bytes(serialization.Encoding.PEM))`;
  await command(config.python, ['-c', tlsScript]);
  active();
  common.CONVERSATION_GRPC_TLS_MODE = 'tls';
  common.CONVERSATION_GRPC_TLS_CA_CERT_PATH = path.join(runDirectory, 'adk-tls.crt');
  // Node25 rejects an IP-literal TLS SNI; verify the generated localhost SAN.
  common.CONVERSATION_GRPC_TLS_SERVER_NAME_OVERRIDE = 'localhost';
  const env = { ...common, ENVIRONMENT: 'prod', PYTHONPATH: adk, PYTHONDONTWRITEBYTECODE: '1',
    HOST: '127.0.0.1', PORT: '8006', GRPC_PORT: '50056', GRPC_ENABLED: 'true',
    GRPC_ALLOW_INSECURE: 'false', GRPC_API_KEY: common.CONVERSATION_GRPC_API_KEY,
    GRPC_TLS_CERT_PATH: path.join(runDirectory, 'adk-tls.crt'), GRPC_TLS_KEY_PATH: path.join(runDirectory, 'adk-tls.key'),
    LOG_CONFIG_PATH: path.join(adk, 'src/logger/uvicorn_disable_logging.json'), LOG_LEVEL: 'INFO',
    DATABASE_URL: 'postgresql+asyncpg://postgres:pr06-test-only@127.0.0.1:55526/agentstore_test',
    DB_POOL_SIZE: '5', DB_POOL_MAX_OVERFLOW: '5', DB_POOL_AUTO_SCALE: 'false',
    API_URL: 'http://127.0.0.1:3301/api/v1', REDIS_HOST: '127.0.0.1', REDIS_PORT: '56386', REDIS_DB: '0',
    ADK_API_KEY: secret(), VECTORSTORE_API_KEY: secret(), lINKUP_API_KEY: 'pr06-unused-no-search',
    WEB_SEARCH_PROMPT: 'Search is not configured for PR06 isolated single-agent requests.',
    // Required legacy settings: syntactically valid but unreachable and never live credentials.
    AZURE_DATALAKE_CONNECTION_STRING: `DefaultEndpointsProtocol=http;AccountName=pr06unused;AccountKey=${Buffer.alloc(32, 1).toString('base64')};BlobEndpoint=http://127.0.0.1:59993/pr06unused;`,
    AZURE_DATALAKE_FILE_SYSTEM_NAME: 'pr06-unused', STORAGE_PROVIDER: 'ceph',
    CEPH_ENDPOINT: 'http://127.0.0.1:59993', CEPH_ACCESS_KEY_ID: secret(), CEPH_SECRET_ACCESS_KEY: secret(),
    EMBEDDING_MODEL: common.EMBEDDING_MODEL ?? config.model, APPLICATION_INSIGHTS_LOG: 'false',
    QDRANT_COLLECTION_NAME: 'default',
    DD_TRACE_ENABLED: 'false', FAKE_EMBEDDINGS: 'false' };
  await privateJson('private-adk-environment.json', env);
  stage = 'adk_startup';
  launch('adk', config.python, [path.join(adk, 'main.py')], env, 8006);
  await save();
  await ready('http://127.0.0.1:8006/health/ready', body => body?.status === 'ok' && body?.grpc === 'serving');
  stage = 'classic_tls_channel_readiness';
  const { ConfigService } = requireBackend('@nestjs/config');
  const { buildGrpcChannelCredentials } = requireBackend('./dist/common/grpc/grpc-security.util.js');
  const grpc = requireBackend('@grpc/grpc-js');
  const security = buildGrpcChannelCredentials(new ConfigService({ grpcSecurity: {
    tlsMode: common.CONVERSATION_GRPC_TLS_MODE, tlsCaCertPath: common.CONVERSATION_GRPC_TLS_CA_CERT_PATH,
    tlsServerNameOverride: common.CONVERSATION_GRPC_TLS_SERVER_NAME_OVERRIDE,
  } }));
  const probe = new grpc.Client(common.CONVERSATION_GRPC_URL, security.credentials, security.options);
  try { await new Promise((resolve, reject) => probe.waitForReady(Date.now() + 5000, error => error ? reject(new Error('classic_tls_channel_not_ready')) : resolve())); }
  finally { probe.close(); }
  record.adkReadiness = 'http_ready_and_actual_classic_tls_channel_ready'; await save();
}

async function main() {
  const config = options();
  stage = 'provider_configuration';
  const provider = await providerConfiguration();
  if (config.mode === '--list-models') return listModels(provider.values);
  stage = 'rebuilt_artifacts';
  const entry = path.join(backend, 'dist/main.js');
  await access(entry); await access(path.join(backend, 'dist/modules/conversation/utils/sse-measurements.js'));
  stage = 'dedicated_ports';
  await Promise.all((config.mode === '--start-stack' ? [3301, 3302, 8006, 50056, 56386] : [3301, 3302]).map(assertFree));
  stage = 'dedicated_postgres'; await databasePreflight();
  if (config.mode === '--check') {
    console.log(JSON.stringify({ status: 'backend_preflight_passed_only', ports: [3301, 3302], providerProvenance: provider.provenance,
      pending: ['start-stack with explicit Python/model; runtime checks not performed'] })); return;
  }
  if (config.mode === '--start-stack') await access(config.python);
  stage = 'isolated_environment';
  runDirectory = path.join(root, '.tmp', `pr06-local-${randomUUID()}`);
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  // Same static proto assets as the backend postbuild script. Some clients
  // resolve from cwd/src; retain env-free cwd without changing production code.
  for (const moduleName of ['agent', 'conversation', 'conversation-v2', 'playbook-flow', 'worky']) {
    const relative = path.join('modules', moduleName, 'proto');
    await cp(path.join(backend, 'src', relative), path.join(runDirectory, 'src', relative), { recursive: true });
  }
  record = { supervisorPid: process.pid, createdAt: new Date().toISOString(), status: 'starting',
    processes: [], providerProvenance: provider.provenance, bindWarning: 'Backend and ADK gRPC use wildcard binds; host firewall must isolate local ports.',
    cleanup: 'Ctrl+C supervisor: own ChildProcess objects and exact created Redis ID only; PG/fixture cleanup belongs to primary.' };
  await save();
  process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  secrets.add(privateKey);
  await writeFile(path.join(runDirectory, 'mcp-signing.key'), privateKey, { mode: 0o600 });
  const common = { ...minimalEnvironment(), ...provider.values, NODE_ENV: 'production', LOG_LEVEL: 'info',
    POSTGRES_HOST: pgConfig.host, POSTGRES_PORT: '55526', POSTGRES_DB: pgConfig.database,
    POSTGRES_USER: pgConfig.user, POSTGRES_PASSWORD: pgConfig.password, POSTGRES_SSL: 'false', POSTGRES_MAX_POOL_SIZE: '10',
    JWT_SECRET: secret(), ENCRYPTION_KEY: secret(),
    MCP_JWT_PRIVATE_KEY_FILE: path.join(runDirectory, 'mcp-signing.key'), MCP_JWT_ISSUER: `pr06-${path.basename(runDirectory)}`,
    CONVERSATION_GRPC_URL: '127.0.0.1:50056', CONVERSATION_GRPC_API_KEY: secret(), CONVERSATION_GRPC_TLS_MODE: 'insecure',
    CONVERSATION_V2_GRPC_URL: '127.0.0.1:59994', PLAYBOOK_FLOW_GRPC_URL: '127.0.0.1:50056',
    WORKY_ORCHESTRATOR_GRPC_URL: '127.0.0.1:59995',
    AI_SERVICE_URL: 'http://127.0.0.1:8006',
    AGENT_MCP_SERVER_URL: 'http://127.0.0.1:59991/mcp', PLAYBOOK_MCP_SERVER_URL: 'http://127.0.0.1:59992/mcp',
    SEMANTIC_MODEL_MCP_SERVER_URL: 'http://127.0.0.1:59996/mcp', INDEXING_API_URL: 'http://127.0.0.1:59997',
    COMMUNITY_GRAPH_URL: 'http://127.0.0.1:59998', URL_TO_PDF_API_URL: 'http://127.0.0.1:59999',
    CEPH_S3_ENDPOINT: 'http://127.0.0.1:59993', CEPH_S3_ACCESS_KEY_ID: secret(), CEPH_S3_SECRET_ACCESS_KEY: secret() };
  for (const key of ['AGENT_MCP_BACKEND_SERVICE_TOKEN', 'PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN', 'SEMANTIC_MODEL_MCP_SERVICE_TOKEN',
    'ADK_RUNTIME_MCP_RENEWAL_TOKEN', 'APP_RUNTIME_BIND_TOKEN', 'SEMANTIC_RUNTIME_BACKEND_SERVICE_TOKEN',
    'ADK_ROOT_RUNTIME_SERVICE_TOKEN', 'ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN', 'INTERNAL_SERVICE_SECRET']) common[key] = secret();
  let identities;
  if (config.mode === '--start-stack') {
    active();
    stage = 'new_fixture_sql_seed'; provisioning = provisionBase(config.model, config.api);
    identities = await provisioning;
    active();
    await startAdk(config, common);
  }
  remember(common); await privateJson('private-environment.json', common);
  stage = 'backend_startup';
  for (const port of [3301, 3302]) {
    if (stopping) return;
    launch(`backend-${port}`, process.execPath, [entry], { ...common, PORT: String(port),
      BACKEND_URL: `http://127.0.0.1:${port}`, REPLICA_ID: `pr06-${port}-${path.basename(runDirectory)}` }, port);
  }
  await save();
  await Promise.all([3301, 3302].map(port => ready(`http://127.0.0.1:${port}/api/v1/health/live`)));
  record.backendLiveness = 'both_http_live'; await save();
  if (identities) {
    const tokens = await authenticateFixtures(identities);
    stage = 'fixture_database_verification';
    await withDb(async client => {
      const { rows } = await client.query(`SELECT count(*)::int AS count FROM conversation.conversations
        WHERE id = ANY($1::bpchar[]) AND message_count=0 AND initialization_status='ready'`, [identities.map(identity => identity.conversationId)]);
      if (rows[0]?.count !== 30) fail('thirty_empty_owned_conversations_not_verified');
      const sessions = await client.query(`SELECT count(DISTINCT user_id)::int AS count FROM identity.sessions
        WHERE user_id=ANY($1::bpchar[]) AND is_valid=true AND expires_at>now()`, [identities.map(identity => identity.userId)]);
      if (sessions.rows[0]?.count !== 30) fail('thirty_real_login_sessions_not_verified');
    });
    const fixture = { isolated: true, users: 30, tabs: 1, replicas: [3301, 3302].map(port => `http://127.0.0.1:${port}/api/v1`),
      identities: identities.map(({ userId, conversationId, tokenEnv }) => ({ userId, conversationId, tokenEnv })),
      prompts: ['Reply with a short paragraph explaining why the sky appears blue.'], model: config.model,
      dataset: 'PR06 generated empty single-agent conversations', hardware: `${os.platform()} ${os.cpus().length} logical CPUs`,
      deployment: 'isolated native two-backend + ADK TLS + owned Docker Redis + dedicated PG55526',
      baselineSha: '66501b7972dd359568d97d676a6d8ab2a933c65f', deadlineMs: 180000 };
    await privateJson('benchmark.json', fixture); await privateJson('tokens.json', tokens);
    // Separate runner loads token values privately, then invokes the existing benchmark.
    const runner = `import {readFile,writeFile} from 'node:fs/promises';\nimport {benchmark} from ${JSON.stringify(pathToFileURL(path.join(root, 'scripts/benchmark-classic-conversation-sse.mjs')).href)};\nconst tokens=JSON.parse(await readFile(new URL('./tokens.json',import.meta.url),'utf8'));\nObject.assign(process.env,tokens);\nconst config=JSON.parse(await readFile(new URL('./benchmark.json',import.meta.url),'utf8'));\nconst report=await benchmark(config);\nawait writeFile(new URL('./benchmark-report.json',import.meta.url),JSON.stringify(report,null,2),{mode:0o600});\nconsole.log(JSON.stringify({transportPass:report.transportPass,releaseQualified:report.releaseQualified,failures:report.failures}));\nprocess.exitCode=report.transportPass?0:1;\n`;
    await writeFile(path.join(runDirectory, 'run-benchmark.mjs'), runner, { mode: 0o600 });
    record.status = 'fixtures_authenticated_cross_replica_checked_real_generation_pending';
    record.benchmarkCommand = `node "${path.join(runDirectory, 'run-benchmark.mjs')}"`;
  } else record.status = 'backends_live_only_adk_and_fixtures_pending';
  await save();
  console.log(JSON.stringify({ status: record.status, ownershipFile: path.join(runDirectory, 'ownership.json'),
    processes: record.processes, benchmarkCommand: record.benchmarkCommand,
    warning: 'Not release-qualified. No real generation has run; start benchmark promptly before access tokens expire.' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(async error => {
  process.exitCode = 1;
  const code = error.safeCode ?? 'internal_failure';
  console.error(JSON.stringify({ status: 'failed', stage, code, runDirectory,
    diagnostic: 'Inspect redacted local logs. No runtime PASS; no raw driver/credential output.' }));
  if (runDirectory) await appendFile(path.join(runDirectory, 'bootstrap.log'),
    redact(`${stage}: ${error.stack ?? error.message}\n`), { mode: 0o600 }).catch(() => {});
  if (record) { record.failure = { stage, code }; await save().catch(() => {}); }
  await stop();
});
