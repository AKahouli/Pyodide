// Setup only: Microsoft's JSONC parser preserves untouched provider comments.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveMemoryTarget } from './runtime/lib/memory-settings.mjs';

const [action, configDir, repoRoot, backupDir] = process.argv.slice(2);
const require = createRequire(path.join(configDir, 'package.json'));
const { parse, modify, applyEdits } = require('jsonc-parser');
const source = path.dirname(fileURLToPath(import.meta.url));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function read(filename) {
  const text = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '') : '{}';
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !object(value)) throw Error('Invalid configuration; existing file was not overwritten.');
  return { text, value };
}
// Defaults precede existing permission patterns under native last-match semantics.
function merge(defaults, existing) {
  if (!object(defaults) || !object(existing)) return existing;
  const result = Object.create(null);
  for (const key of Object.keys(defaults)) if (!Object.hasOwn(existing, key)) result[key] = defaults[key];
  for (const key of Object.keys(existing)) result[key] = Object.hasOwn(defaults, key) ? merge(defaults[key], existing[key]) : existing[key];
  return result;
}
function write(filename, text, original, value) {
  if (JSON.stringify(original) === JSON.stringify(value)) return;
  if (fs.existsSync(filename)) {
    fs.mkdirSync(backupDir, { recursive: true });
    const saved = path.join(backupDir, path.basename(filename));
    if (!fs.existsSync(saved)) fs.copyFileSync(filename, saved);
  }
  for (const key of Object.keys(value)) {
    if (JSON.stringify(original[key]) !== JSON.stringify(value[key])) {
      text = applyEdits(text, modify(text, [key], value[key], { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
    }
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = filename + '.setup-' + process.pid;
  try { fs.writeFileSync(temporary, text + (text.endsWith('\n') ? '' : '\n')); fs.renameSync(temporary, filename); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
const memoryPath = process.env.HINDSIGHT_CONFIG || path.join(os.homedir(), '.hindsight', 'coding-agent.json');
try {
  if (action === 'opencode' || action === 'memory-registration') {
    const json = path.join(configDir, 'opencode.json'), jsonc = path.join(configDir, 'opencode.jsonc');
    if (fs.existsSync(json) && fs.existsSync(jsonc)) throw Error('Both opencode.json and opencode.jsonc exist; reconcile them before setup.');
    const filename = fs.existsSync(jsonc) ? jsonc : json;
    const { text, value } = read(filename);
    if (action === 'opencode') write(filename, text, value, merge(read(path.join(source, 'config/opencode.example.json')).value, value));
    else {
      if (!Array.isArray(value.plugin) || !value.plugin.some(entry => {
        const name = Array.isArray(entry) ? entry[0] : entry;
        return typeof name === 'string' && /\/\.hindsight\/coding-agents(?:\/?$|\/dist\/opencode(?:\.[mc]?js)?$)/.test(name.replaceAll('\\', '/'));
      })) throw Error('Memory plugin registration missing; inspect the native installer result.');
      console.log('Memory plugin registration verified.');
    }
  } else if (action === 'memory') {
    const { text, value } = read(memoryPath);
    const defaults = read(path.join(source, 'config/hindsight.example.json')).value;
    defaults.optInPaths = [];
    // An existing client may rely on implicit cloud defaults, environment or
    // nested harness/path/bank connections. Never replace those with localhost.
    if (fs.existsSync(memoryPath)) {
      for (const key of ['serverMode', 'apiUrl', 'apiPort']) delete defaults[key];
    }
    const next = merge(defaults, value);
    const nested = object(next.harnesses?.opencode) && Object.hasOwn(next.harnesses.opencode, 'optInPaths');
    const paths = nested ? next.harnesses.opencode.optInPaths : next.optInPaths;
    if (!Array.isArray(paths)) throw Error('Memory optInPaths must be an array.');
    const normalized = path.resolve(repoRoot).replaceAll('\\', '/');
    if (!paths.some(item => typeof item === 'string' && item.replaceAll('\\', '/').toLowerCase() === normalized.toLowerCase())) {
      const enrolled = [...paths, normalized];
      if (nested) next.harnesses = { ...next.harnesses, opencode: { ...next.harnesses.opencode, optInPaths: enrolled } };
      else next.optInPaths = enrolled;
    }
    write(memoryPath, text, value, next);
  } else if (action === 'memory-info' || action === 'memory-check' || action === 'memory-policy') {
    const { cfg, bankId } = resolveMemoryTarget(read(memoryPath).value, repoRoot);
    const base = cfg.apiUrl?.replace(/\/?$/, '/');
    const headers = cfg.apiToken ? { Authorization: 'Bearer ' + cfg.apiToken } : {};
    const request = async (route, options = {}) => fetch(new URL(route, base), { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(10000) });
    if (action === 'memory-policy') {
      const unsupported = 'Memory policy requires recall score-filter support; upgrade the Hindsight service before retrying.';
      try {
        if (cfg.disabled || cfg.retainSessions === false || !bankId) throw Error();
        const desired = cfg.defaultBankConfig;
        if (!object(desired) || !['retain_mission', 'observations_mission'].every(key => typeof desired[key] === 'string' && desired[key].trim()) || !['retain_chunk_size', 'recall_max_tokens'].every(key => Number.isSafeInteger(desired[key]) && desired[key] > 0) || !['enable_graph_retrieval', 'enable_temporal_retrieval'].every(key => typeof desired[key] === 'boolean')) throw Error();
        let schema;
        try {
          const response = await request('openapi.json');
          if (response.ok) schema = await response.json();
        } catch { /* Unsupported or unavailable schema is reported without response details. */ }
        const schemas = schema?.components?.schemas;
        const recall = schemas?.RecallRequest?.properties;
        const scoreProperty = recall?.min_scores;
        const references = [scoreProperty?.$ref, ...(Array.isArray(scoreProperty?.anyOf) ? scoreProperty.anyOf.map(item => item?.$ref) : [])];
        const scoreSupported = references.some(reference => typeof reference === 'string' && reference.startsWith('#/components/schemas/') && ['semantic', 'keyword'].every(key => Object.hasOwn(schemas?.[reference.slice('#/components/schemas/'.length)]?.properties ?? {}, key)));
        if (!scoreSupported || !['prefer_observations', 'tags', 'tags_match'].every(key => Object.hasOwn(recall ?? {}, key))) throw Error(unsupported);
        const route = 'v1/default/banks/' + encodeURIComponent(bankId);
        let response = await request(route + '/config');
        if (response.status === 404) {
          const created = await request(route, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (!created.ok) throw Error();
          response = await request(route + '/config');
        }
        if (!response.ok) throw Error();
        const before = await response.json();
        if (!object(before) || !object(before.config) || !object(before.overrides)) throw Error();
        const current = before.config;
        if (!['enable_graph_retrieval', 'enable_temporal_retrieval'].every(key => typeof current[key] === 'boolean')) throw Error(unsupported);
        const strategy = { ...(object(current.retain_strategies?.conversation) ? current.retain_strategies.conversation : {}), ...(object(before.overrides.retain_strategies?.conversation) ? before.overrides.retain_strategies.conversation : {}) };
        const desiredStrategy = { ...strategy, retain_mission: desired.retain_mission, retain_extraction_mode: 'concise', retain_chunk_size: desired.retain_chunk_size };
        const updates = {};
        for (const key of ['retain_mission', 'observations_mission', 'retain_chunk_size', 'recall_max_tokens', 'enable_graph_retrieval', 'enable_temporal_retrieval']) if (current[key] !== desired[key]) updates[key] = desired[key];
        if (Object.entries(desiredStrategy).some(([key, value]) => strategy[key] !== value)) {
          updates.retain_strategies = { ...(object(current.retain_strategies) ? current.retain_strategies : {}), ...(object(before.overrides.retain_strategies) ? before.overrides.retain_strategies : {}), conversation: desiredStrategy };
        }
        if (Object.keys(updates).length) {
          fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
          const safeBank = bankId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'bank';
          const backup = path.join(backupDir, `hindsight-bank-${safeBank}-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
          fs.writeFileSync(backup, JSON.stringify({ bankId, config: before.config, overrides: before.overrides }, null, 2), { flag: 'wx', mode: 0o600 });
          const patched = await request(route + '/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }) });
          if (!patched.ok) throw Error();
        }
        const verified = await request(route + '/config');
        if (!verified.ok) throw Error();
        const result = (await verified.json()).config;
        if (!object(result) || ['retain_mission', 'observations_mission', 'retain_chunk_size', 'recall_max_tokens', 'enable_graph_retrieval', 'enable_temporal_retrieval'].some(key => result[key] !== desired[key]) || !object(result.retain_strategies?.conversation) || ['retain_mission', 'retain_extraction_mode', 'retain_chunk_size'].some(key => result.retain_strategies.conversation[key] !== desiredStrategy[key])) throw Error();
        console.log('Memory policy verified.');
      } catch (error) { throw Error(error.message === unsupported ? unsupported : 'Memory policy setup or verification failed; inspect the private backup and bank configuration.'); }
    } else {
    let healthy = false;
    try {
      const response = await request('health');
      const health = response.ok ? await response.json() : {};
      healthy = health.status === 'healthy' && health.database === 'connected';
    } catch { /* Report availability without printing authenticated URLs. */ }
    if (action === 'memory-info') {
      console.log(JSON.stringify({ localBootstrap: cfg.serverMode === 'self-hosted' && base === 'http://127.0.0.1:9077/', reachable: healthy, enabled: !cfg.disabled && cfg.retainSessions !== false && !process.env.HINDSIGHT_DISABLE_HOOKS }));
    } else {
      if (!healthy || cfg.disabled || cfg.retainSessions === false || process.env.HINDSIGHT_DISABLE_HOOKS) throw Error('Memory is unavailable or disabled; follow HINDSIGHT-SETUP.md.');
      const route = 'v1/default/banks/' + encodeURIComponent(bankId);
      let stats = await request(route + '/stats');
      if (stats.status === 404) {
        const created = await request(route, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!created.ok) throw Error('Memory bank initialization failed.');
        stats = await request(route + '/stats');
      }
      const value = stats.ok ? await stats.json() : {};
      if (!stats.ok || !object(value) || value.error || value.detail || value.status === 'error') throw Error('Memory bank verification failed.');
      console.log('Memory API and repository bank verified. Extraction/capture still need onboarding.');
    }
    }
  } else throw Error('Unknown setup configuration action.');
} catch (error) {
  // Never echo configuration, tokens, authenticated URLs or raw fetch errors.
  console.error(error.message.startsWith('Memory') || error.message.startsWith('Both ') || error.message.startsWith('Invalid ') ? error.message : 'Setup configuration failed; inspect the local configuration privately.');
  process.exitCode = 1;
}
