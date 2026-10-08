#!/usr/bin/env node
// Pretty-prints Yellowmind log envelopes (contracts/observability) for local dev consoles.
// Usage: npm run start:dev 2>&1 | node scripts/observability/pretty.mjs
// Non-JSON lines pass through untouched, so framework output stays visible.
import readline from 'node:readline';

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
      if (e && e.event_name && e.severity_text) return void console.log(render(e));
    } catch { /* not an envelope */ }
  }
  console.log(line);
});
