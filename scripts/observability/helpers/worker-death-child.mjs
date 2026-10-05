// Fault helper: real worker death (writer thread exits nonzero) -> parent restart -> recovery.
import path from 'node:path';
import { openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'observability-ts');
const require = createRequire(path.join(pkgRoot, 'package.json'));
const { _createForTests } = require(path.join(pkgRoot, 'dist', 'index.js'));

const sink = process.argv[2];
const fd = openSync(sink, 'w');
const logger = _createForTests({
  serviceName: 'fault-probe',
  serviceVersion: 'p09',
  environment: 'local-test',
  minLevel: 'INFO',
  workerPath: path.join(pkgRoot, 'dist', 'worker.cjs'),
  workerEnv: { OBS_WRITER_FD: String(fd) },
});

logger.info('service.started', { launcher: 'before-death' });
await new Promise((r) => setTimeout(r, 300));

// Kill the real writer thread (T08): terminate() exits with code 1, so the parent must count
// the death, release credits and restart the worker.
logger.__writer.worker.terminate();
await new Promise((r) => setTimeout(r, 1500)); // restart backoff (100ms) + recovery
logger.info('service.started', { launcher: 'after-death' });
await new Promise((r) => setTimeout(r, 400));
const m = logger.metricsSnapshot();
await logger.shutdown(1000);
process.stdout.write(JSON.stringify({ restarts: m.writer_restarts_total, writtenTotal: m.written_total }) + '\n');
process.exit(0);
