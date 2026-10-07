#!/usr/bin/env node
// End-to-end smoke (plan §15): query conformance against the isolated stack. Requires the
// infra/observability compose profile running locally; otherwise reports BLOCKED (exit 2).
// Usage: node scripts/observability/smoke.mjs --profile local-test
import { request } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
if (process.argv[process.argv.indexOf('--profile') + 1] !== 'local-test') {
  console.error('[smoke] BLOCKED: only --profile local-test is permitted.');
  process.exit(2);
}

// Local-test credentials only (infra/observability/.env); never production secrets.
const host = process.env.OBS_SMOKE_HOST ?? '127.0.0.1';
const port = Number(process.env.OBS_SMOKE_PORT ?? 3100);
const auth = Buffer.from(`${process.env.OBS_LOKI_USER ?? 'alloy'}:${process.env.OBS_LOKI_PASSWORD ?? 'local-test-only'}`).toString('base64');

function loki(pathAndQuery) {
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path: pathAndQuery, headers: { Authorization: `Basic ${auth}` }, timeout: 10_000 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

const results = [];
const record = (id, name, status, detail) => { results.push({ id, name, status, detail }); console.log(`[${status}] ${id} ${name} — ${detail}`); };

const ALLOWED = new Set(['service_name', 'environment', 'severity_text', 'container', 'source', 'filename', 'job']);

let reachable = true;
try {
  const ready = await loki('/ready');
  reachable = ready.status === 200 && /ready/i.test(ready.body);
} catch { reachable = false; }
if (!reachable) {
  console.log('[BLOCKED] Loki gateway unreachable — start infra/observability compose first.');
  process.exit(2);
}

// T25: index-label allowlist — no per-user/request/trace streams may exist.
const labels = JSON.parse((await loki('/loki/api/v1/labels')).body);
const unexpected = labels.data.filter((l) => !ALLOWED.has(l));
record('T25', 'index-label allowlist', unexpected.length === 0 ? 'PASS' : 'FAIL',
  unexpected.length === 0 ? `labels=[${labels.data.join(', ')}]` : `unexpected labels: ${unexpected.join(', ')}`);

// Canary pipeline health (T19-lite): events flow through docker → alloy → gateway → loki.
const end = new Date().toISOString();
const start = new Date(Date.now() - 15 * 60 * 1000).toISOString();
const lokiJson = async (pathAndQuery) => {
  const res = await loki(pathAndQuery);
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error(`non-JSON response (${res.status}): ${res.body.slice(0, 120)}`);
  }
};
const range = encodeURIComponent('{service_name="observability-canary"}');
const canary = await lokiJson(`/loki/api/v1/query_range?query=${range}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=5`);
const canaryCount = canary.data?.result?.reduce((n, s) => n + s.values.length, 0) ?? 0;
record('T24a', 'canary events queryable by service_name', canaryCount > 0 ? 'PASS' : 'FAIL', `${canaryCount} canary lines`);

// Structured metadata filter (T24b): event body contains the envelope; text filter works.
const envQ = await lokiJson(
  `/loki/api/v1/query_range?query=${encodeURIComponent('{service_name="observability-canary"} |= "event_name"')}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=1`,
);
record('T24b', 'envelope body searchable', (envQ.data?.result?.reduce((n, s) => n + s.values.length, 0) ?? 0) > 0 ? 'PASS' : 'FAIL', 'JSON body retained');

const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n[smoke] pass=${results.length - failed} fail=${failed}`);
const fs = await import('node:fs');
const outDir = path.join(repoRoot, '.generated', 'observability-reports');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'smoke.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
process.exit(failed > 0 ? 1 : 0);
