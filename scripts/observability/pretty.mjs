#!/usr/bin/env node
// Pretty-prints Yellowmind log envelopes (contracts/observability) for local dev consoles.
// Usage: npm run start:dev 2>&1 | node scripts/observability/pretty.mjs
// Non-JSON lines pass through untouched, so framework output stays visible.
import readline from 'node:readline';
import { readFileSync } from 'node:fs';

// Display-only severity allowlist — never touches the wire format or remote sinks.
// Set LOG_DISPLAY_LEVELS to a pipe/comma/space list, e.g. LOG_DISPLAY_LEVELS=ERROR|WARN.
// Unset/empty -> show every level. Values are case-insensitive and accept the legacy
// aliases from contracts/observability/severity.v1.json (warning->WARN, critical->FATAL, ...).
const LEVELS = new Set(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
const ALIASES = {
  warning: 'WARN', warn: 'WARN', error: 'ERROR', critical: 'FATAL', fatal: 'FATAL',
  info: 'INFO', debug: 'DEBUG', trace: 'TRACE', verbose: 'TRACE',
};

// An already-exported variable wins; otherwise read the key from <cwd>/.env so a plain
// `python main.py | node .../pretty.mjs` honours the project's .env without --env-file.
function readEnvFile(key, file = '.env') {
  try {
    const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
    return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : undefined;
  } catch { return undefined; }
}

function resolveLevelFilter() {
  const raw = process.env.LOG_DISPLAY_LEVELS ?? readEnvFile('LOG_DISPLAY_LEVELS');
  if (!raw) return null;
  const picked = String(raw).split(/[|,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean)
    .map((t) => ALIASES[t] ?? t.toUpperCase()).filter((l) => LEVELS.has(l));
  return picked.length ? new Set(picked) : null;
}

const levelFilter = resolveLevelFilter();
if (levelFilter) process.stderr.write(`[pretty] showing only: ${[...levelFilter].join(', ')}\n`);

const C = process.stdout.isTTY ? {
  FATAL: '\x1b[1;31m', ERROR: '\x1b[31m', WARN: '\x1b[33m', INFO: '\x1b[32m',
  DEBUG: '\x1b[36m', TRACE: '\x1b[90m', dim: '\x1b[2m', reset: '\x1b[0m',
} : {};
const c = (name) => C[name] ?? '';

const fmtVal = (v) => typeof v === 'string' ? v : JSON.stringify(v);

function render(e) {
  const ts = new Date(e.timestamp);
  const time = isNaN(ts)
    ? String(e.timestamp ?? '')
    : ts.toTimeString().slice(0, 8) + '.' + String(ts.getMilliseconds()).padStart(3, '0');
  const sev = String(e.severity_text ?? '?').padEnd(5);
  let out = `${c('dim')}${time}${c('reset')} ${c(e.severity_text)}${sev}${c('reset')} ${e.event_name} ${e.message ?? ''}`;

  const kv = Object.entries(e.attributes ?? {}).map(([k, v]) => `${k}=${fmtVal(v)}`);
  for (const k of ['request_id', 'username', 'workspace_id', 'conversation_id', 'run_id', 'job_id', 'agent_id']) {
    if (e[k]) kv.push(`${k}=${e[k]}`);
  }
  if (kv.length) out += `  ${c('dim')}${kv.join(' ')}${c('reset')}`;
  if (e.trace_id) out += `  ${c('dim')}trace=${String(e.trace_id).slice(0, 8)}${c('reset')}`;
  if (e.truncated_fields) out += `\n    ${c('dim')}truncated: ${e.truncated_fields.join(', ')}${c('reset')}`;

  if (e.error) {
    out += `\n    ${c(e.severity_text)}${e.error.type ?? ''}${e.error.code ? ` [${e.error.code}]` : ''}: ${e.error.message ?? ''}${c('reset')}`;
    if (e.error.stack) out += '\n' + e.error.stack.split('\n').slice(1).map((l) => `      ${l.trim()}`).join('\n'); // header line duplicates the summary
  }
  return out;
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (line.charCodeAt(0) === 123) { // '{' — cheap pre-filter before JSON.parse
    try {
      const e = JSON.parse(line);
      if (e && e.event_name && e.severity_text) {
        if (levelFilter && !levelFilter.has(String(e.severity_text).toUpperCase())) return;
        return void console.log(render(e));
      }
    } catch { /* not an envelope */ }
  }
  console.log(line);
});
