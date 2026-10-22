// Setup only: Microsoft's JSONC parser preserves untouched provider comments.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

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
function merge(defaults, existing, key = '') {
  if (Array.isArray(defaults) && Array.isArray(existing)) {
    if (key !== 'permissions') return existing;
    return [...defaults.filter(rule => !existing.some(item => JSON.stringify(item) === JSON.stringify(rule))), ...existing];
  }
  if (!object(defaults) || !object(existing)) return existing;
  const result = Object.create(null);
  for (const key of Object.keys(defaults)) if (!Object.hasOwn(existing, key)) result[key] = defaults[key];
  for (const key of Object.keys(existing)) result[key] = Object.hasOwn(defaults, key) ? merge(defaults[key], existing[key], key) : existing[key];
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
try {
  if (action === 'opencode') {
    const json = path.join(configDir, 'opencode.json'), jsonc = path.join(configDir, 'opencode.jsonc');
    if (fs.existsSync(json) && fs.existsSync(jsonc)) throw Error('Both opencode.json and opencode.jsonc exist; reconcile them before setup.');
    const filename = fs.existsSync(jsonc) ? jsonc : json;
    const { text, value } = read(filename);
    const defaults = read(path.join(source, 'config/opencode.example.json')).value;
    // V2 accepts V1 fields, but native defaults would override their values.
    // Preserve personal legacy policy/provider/agent settings for V2 to normalize.
    for (const [native, legacy] of Object.entries({ agents: ['agent', 'mode'], providers: ['provider'], permissions: ['permission', 'tools'] })) {
      if (legacy.some(key => Object.hasOwn(value, key))) delete defaults[native];
    }
    if (object(value.compaction) && ['reserved', 'preserve_recent_tokens'].some(key => Object.hasOwn(value.compaction, key))) delete defaults.compaction;
    if (Object.hasOwn(value, 'subagent_depth')) defaults.experimental.subagent_depth = value.subagent_depth;
    if (object(value.mcp)) {
      for (const name of Object.keys(defaults.mcp.servers)) {
        if (Object.hasOwn(value.mcp, name)) delete defaults.mcp.servers[name];
      }
    }
    write(filename, text, value, merge(defaults, value));
  } else throw Error('Unknown setup configuration action.');
} catch (error) {
  // Never echo configuration, tokens, authenticated URLs or raw fetch errors.
  console.error(error.message.startsWith('Both ') || error.message.startsWith('Invalid ') || error.message.startsWith('Unknown ') ? error.message : 'Setup configuration failed; inspect the local configuration privately.');
  process.exitCode = 1;
}
