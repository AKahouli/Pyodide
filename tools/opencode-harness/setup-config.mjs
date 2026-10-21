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
try {
  if (action === 'opencode') {
    const json = path.join(configDir, 'opencode.json'), jsonc = path.join(configDir, 'opencode.jsonc');
    if (fs.existsSync(json) && fs.existsSync(jsonc)) throw Error('Both opencode.json and opencode.jsonc exist; reconcile them before setup.');
    const filename = fs.existsSync(jsonc) ? jsonc : json;
    const { text, value } = read(filename);
    write(filename, text, value, merge(read(path.join(source, 'config/opencode.example.json')).value, value));
  } else throw Error('Unknown setup configuration action.');
} catch (error) {
  // Never echo configuration, tokens, authenticated URLs or raw fetch errors.
  console.error(error.message.startsWith('Both ') || error.message.startsWith('Invalid ') || error.message.startsWith('Unknown ') ? error.message : 'Setup configuration failed; inspect the local configuration privately.');
  process.exitCode = 1;
}
