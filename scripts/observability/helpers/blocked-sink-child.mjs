// Fault helper: emits events to stderr (the never-draining pipe) and reports JSON on stdout.
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'observability-ts');
const require = createRequire(path.join(pkgRoot, 'package.json'));
require(path.join(pkgRoot, 'dist', 'index.js'));
const { _createForTests } = require(path.join(pkgRoot, 'dist', 'index.js'));

const opts = JSON.parse(process.argv[2] ?? '{}');
const logger = _createForTests({
  serviceName: 'fault-probe',
  serviceVersion: 'p09',
  environment: 'local-test',
  minLevel: 'INFO',
  maxQueueBytes: 4 * 1024 * 1024,
});

const latencies = [];
let rssPeak = 0;
const t0 = performance.now();
for (let i = 0; i < opts.events; i++) {
  const s = performance.now();
  logger.info('service.started', { launcher: 'x'.repeat(opts.bytesPerEvent) });
  latencies.push(performance.now() - s);
  if (i % 200 === 0) {
    const rss = process.memoryUsage().rss;
    if (rss > rssPeak) rssPeak = rss;
  }
}
const wallMs = performance.now() - t0;
// give the writer a moment to back up, then sample RSS again (plateau check)
await new Promise((r) => setTimeout(r, 2000));
rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
const m = logger.metricsSnapshot();
latencies.sort((a, b) => a - b);
const p99 = latencies[Math.floor(latencies.length * 0.99)];
process.stdout.write(
  JSON.stringify({ events: opts.events, wallMs: Math.round(wallMs), emitLatencyP99Us: p99 * 1000, rssPeakBytes: rssPeak, droppedTotal: m.dropped_total, writtenTotal: m.written_total, pendingBytes: m.pending_bytes }) + '\n',
);
process.exit(0);
