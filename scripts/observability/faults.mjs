#!/usr/bin/env node
// Fault suite (plan §15/§12): deterministic local fault tests. Refuses non-test targets;
// never touches production endpoints, volumes, or processes.
// Usage: node scripts/observability/faults.mjs --profile local-test
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const profile = process.argv[process.argv.indexOf('--profile') + 1];
if (profile !== 'local-test') {
  console.error('[faults] BLOCKED: --profile local-test is the only permitted profile in this checkout.');
  process.exit(2);
}

const PY = process.env.OBS_PYTHON ?? 'python';
const results = [];
const record = (id, name, status, detail) => {
  results.push({ id, name, status, detail });
  console.log(`[${status}] ${id} ${name} — ${detail}`);
};

// --- T29: policy checker detects deliberate violations and passes clean afterwards ----------
function t29PolicyBypass() {
  const probe = path.join(repoRoot, 'YellowStorm', 'back', 'src', '__policy_probe_tmp.ts');
  try {
    writeFileSync(probe, "console.log('deliberate policy violation');\n", 'utf8');
    const failing = spawnSync('node', ['scripts/observability/check-policy.mjs'], { cwd: repoRoot, encoding: 'utf8' });
    if (failing.status !== 0 && /console-diagnostic/.test(failing.stdout + failing.stderr)) {
      record('T29', 'policy detects new violations', 'PASS', 'probe console.log failed the gate');
    } else {
      record('T29', 'policy detects new violations', 'FAIL', 'probe was not detected');
    }
  } finally {
    rmSync(probe, { force: true });
  }
  const clean = spawnSync('node', ['scripts/observability/check-policy.mjs'], { cwd: repoRoot, encoding: 'utf8' });
  record('T29b', 'policy passes clean tree', clean.status === 0 ? 'PASS' : 'FAIL', (clean.stdout + clean.stderr).trim().split('\n').pop());
}

// --- T10/T09: real never-draining stderr pipe — caller latency bounded, memory plateaus -------
function t10BlockedSinkTs() {
  const helper = path.join(repoRoot, 'scripts', 'observability', 'helpers', 'blocked-sink-child.mjs');
  const child = spawn(process.execPath, [helper, JSON.stringify({ events: 4000, bytesPerEvent: 768 })], {
    stdio: ['ignore', 'pipe', 'ignore'], // child stderr = the never-draining sink; stdout = reports
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const deadline = Date.now() + 120_000;
  const done = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return Promise.race([
    done.then(() => {
      let report;
      try { report = JSON.parse(out.trim().split('\n').pop()); } catch { record('T10', 'blocked sink (TS)', 'FAIL', 'no report: ' + out.slice(0, 200)); return; }
      const plateauOk = report.rssPeakBytes <= 160 * 1024 * 1024; // 4MiB budget + runtime margin
      const latencyOk = report.emitLatencyP99Us < 5000; // never-blocked caller, generous CI margin
      record('T10', 'blocked sink: caller never blocks, drops counted (TS)',
        plateauOk && latencyOk && report.droppedTotal > 0 ? 'PASS' : 'FAIL',
        `rssPeak=${(report.rssPeakBytes / 1048576).toFixed(1)}MiB p99emit=${report.emitLatencyP99Us.toFixed(0)}µs dropped=${report.droppedTotal}`);
    }),
    new Promise((res) => setTimeout(() => { child.kill(); res(record('T10', 'blocked sink (TS)', 'FAIL', 'timeout')); }, Math.max(1, deadline - Date.now()))),
  ]);
}

// --- T08: real worker death -> restart -> writes recover --------------------------------------
function t08WorkerDeathRecovery() {
  const helper = path.join(repoRoot, 'scripts', 'observability', 'helpers', 'worker-death-child.mjs');
  const sink = path.join(mkdtempSync(path.join(tmpdir(), 'obs-fault-')), 'events.log');
  const res = spawnSync(process.execPath, [helper, sink], { encoding: 'utf8', timeout: 60_000 });
  if (res.status !== 0) { record('T08', 'worker death recovery (TS)', 'FAIL', 'exit ' + res.status + ': ' + res.stderr.slice(0, 300)); return Promise.resolve(); }
  let report;
  try { report = JSON.parse(res.stdout.trim().split('\n').pop()); } catch { record('T08', 'worker death recovery (TS)', 'FAIL', 'bad report'); return Promise.resolve(); }
  const lines = existsSync(sink) ? readFileSync(sink, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  // The killed worker's unflushed SonicBoom buffer is a documented loss window; what must hold:
  // the death is counted, credits release, a new worker spawns, and post-recovery emission lands.
  const ok = report.restarts >= 1 && lines >= 1 && report.writtenTotal >= 2;
  record('T08', 'worker death -> restart -> recovery (TS)', ok ? 'PASS' : 'FAIL',
    `restarts=${report.restarts} recovered_lines=${lines} written=${report.writtenTotal} (lost in killed buffer: ${report.writtenTotal - lines})`);
  return Promise.resolve();
}

// --- T17/T18: diagnostic emission performs zero SQL work (static + dynamic evidence) -----------
function t18NoDiagnosticSql() {
  // The backend integration test (logger.module.spec) already proves zero writes through the
  // wired module; here we assert the facade source never touches the buffer/DB surface.
  const facade = readFileSync(path.join(repoRoot, 'YellowStorm', 'back', 'src', 'modules', 'logger', 'logger.service.ts'), 'utf8');
  const touchesDb = /from '@modules\/logger'|from '.\/log-buffer\.service'|DRIZZLE_DB|\.insert\(/.test(facade);
  record('T18', 'facade has no diagnostic SQL path', touchesDb ? 'FAIL' : 'PASS', 'facade imports no buffer/DB symbols');
}

async function main() {
  t29PolicyBypass();
  t18NoDiagnosticSql();
  await Promise.all([t10BlockedSinkTs(), t08WorkerDeathRecovery()]);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n[faults] profile=local-test  pass=${results.length - failed} fail=${failed}`);
  const outDir = path.join(repoRoot, '.generated', 'observability-reports');
  import('node:fs').then((fs) => { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'faults.json'), JSON.stringify({ profile: 'local-test', at: new Date().toISOString(), results }, null, 2)); });
  process.exit(failed > 0 ? 1 : 0);
}

main();
