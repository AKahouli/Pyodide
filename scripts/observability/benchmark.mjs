#!/usr/bin/env node
// Controlled benchmark (plan §13): SDK-level modes against a file sink on the local runner.
// Whole-service TTFT comparisons require the P10 canary environment and remain NOT_RUN.
// Usage: node scripts/observability/benchmark.mjs --profile controlled
import { performance } from 'node:perf_hooks';
import { mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
if (process.argv[process.argv.indexOf('--profile') + 1] !== 'controlled') {
  console.error('[benchmark] BLOCKED: only --profile controlled is permitted here.');
  process.exit(2);
}
const pkgRoot = path.join(repoRoot, 'packages', 'observability-ts');
const require = createRequire(path.join(pkgRoot, 'package.json'));
const { _createForTests } = require(path.join(pkgRoot, 'dist', 'index.js'));

const EVENTS = Number(process.env.OBS_BENCH_EVENTS ?? 20000);
const WARMUP = 2000;
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

async function runMode(name, minLevel, sinkFd, paced) {
  const logger = _createForTests({
    serviceName: 'bench', serviceVersion: 'p09', environment: 'local-test',
    minLevel, workerPath: path.join(pkgRoot, 'dist', 'worker.cjs'),
    workerEnv: sinkFd ? { OBS_WRITER_FD: String(sinkFd) } : undefined,
  });
  for (let i = 0; i < WARMUP; i++) logger.info('service.started', { launcher: 'warmup' });
  await new Promise((r) => setTimeout(r, 200)); // let the worker drain warmup
  const latencies = [];
  const t0 = performance.now();
  for (let i = 0; i < EVENTS; i++) {
    const s = performance.now();
    logger.info('service.started', { launcher: 'bench', count: i });
    latencies.push(performance.now() - s);
    if (paced && i % 512 === 511) await new Promise((r) => setImmediate(r)); // keep the queue healthy
  }
  const wallMs = performance.now() - t0;
  await logger.shutdown(5000); // bounded drain; `written` is the local output boundary
  const m = logger.metricsSnapshot();
  latencies.sort((a, b) => a - b);
  return {
    mode: name,
    events: EVENTS,
    wall_ms: Math.round(wallMs),
    throughput_written_eps: Math.round(m.written_total / (wallMs / 1000)),
    emit_p50_us: +(quantile(latencies, 0.5) * 1000).toFixed(1),
    emit_p99_us: +(quantile(latencies, 0.99) * 1000).toFixed(1),
    admitted: m.admitted_total, written: m.written_total, dropped: m.dropped_total,
  };
}

const dir = mkdtempSync(path.join(tmpdir(), 'obs-bench-'));
const results = [];
results.push(await runMode('A_logging_disabled', 'FATAL', null, true));   // level gate only
results.push(await runMode('B_healthy_file_sink', 'INFO', openSync(path.join(dir, 'b.log'), 'w'), true));
results.push(await runMode('F_burst_unpaced', 'INFO', openSync(path.join(dir, 'f.log'), 'w'), false));
rmSync(dir, { recursive: true, force: true });

const b = results.find((r) => r.mode === 'B_healthy_file_sink');
const report = {
  at: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  events_per_mode: EVENTS,
  budget: { emit_p99_us: 100 },
  gates: {
    emit_p99_under_100us_healthy: b.emit_p99_us <= 100,
    healthy_no_loss: b.written === b.admitted && b.dropped === 0,
  },
  results,
};
console.log(JSON.stringify(report, null, 2));
const outDir = path.join(repoRoot, '.generated', 'observability-reports');
import('node:fs').then((fs) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'benchmark.json'), JSON.stringify(report, null, 2));
});
process.exit(report.gates.emit_p99_under_100us_healthy ? 0 : 1);
