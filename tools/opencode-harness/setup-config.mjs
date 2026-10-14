// Setup only: Microsoft's JSONC parser preserves untouched provider comments.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
  } else if (action === 'memory-info' || action === 'memory-check') {
    const { cfg, bankId } = resolveMemoryTarget(read(memoryPath).value, repoRoot);
    const base = cfg.apiUrl?.replace(/\/?$/, '/');
    const headers = cfg.apiToken ? { Authorization: 'Bearer ' + cfg.apiToken } : {};
    const request = async (route, options = {}) => fetch(new URL(route, base), { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(10000) });
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
  } else throw Error('Unknown setup configuration action.');
} catch (error) {
  // Never echo configuration, tokens, authenticated URLs or raw fetch errors.
  console.error(error.message.startsWith('Memory') || error.message.startsWith('Both ') || error.message.startsWith('Invalid ') ? error.message : 'Setup configuration failed; inspect the local configuration privately.');
  process.exitCode = 1;
}
