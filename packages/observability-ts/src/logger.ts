import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import { Worker } from 'worker_threads';
import { BUDGETS, severityAtLeast } from './contract';
import { buildEnvelope, buildInvalidEvent, type EnvelopeInput } from './envelope';
import type {
  ContextReader,
  ContextSnapshot,
  LogAttrs,
  LoggerConfig,
  LogMetrics,
  ObservabilityLogger,
  SeverityText,
} from './types';

const RESTART_DELAYS_MS = [100, 1000, 5000];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return clamp(Number.isNaN(parsed) ? fallback : parsed, min, max);
}

export function configFromEnv(overrides?: Partial<LoggerConfig>): LoggerConfig {
  const bootId = randomBytes(8).toString('hex');
  const levelEnv = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'verbose'] as const;
  return {
    serviceName: process.env.OBS_SERVICE_NAME ?? 'unknown-service',
    serviceVersion: process.env.OBS_SERVICE_VERSION ?? 'dev',
    environment: process.env.OBS_ENVIRONMENT ?? process.env.ENVIRONMENT ?? process.env.NODE_ENV ?? 'local',
    serviceInstanceId: process.env.OBS_SERVICE_INSTANCE_ID ?? bootId,
    // Nest's legacy `verbose` maps to TRACE (contracts/observability/severity.v1.json).
    minLevel: levelEnv === 'verbose' ? 'TRACE'
      : (validLevels as readonly string[]).includes(levelEnv) ? (levelEnv.toUpperCase() as SeverityText)
      : 'INFO',
    maxEventBytes: intFromEnv('OBS_LOG_MAX_EVENT_BYTES', BUDGETS.max_event_bytes, 1024, 65536),
    maxQueueEvents: intFromEnv('OBS_LOG_QUEUE_MAX_EVENTS', BUDGETS.max_queue_events, 16, 65536),
    maxQueueBytes: intFromEnv('OBS_LOG_QUEUE_MAX_BYTES', BUDGETS.max_queue_bytes, 65536, 67108864),
    errorReserveBytes: intFromEnv('OBS_LOG_ERROR_RESERVE_BYTES', BUDGETS.error_reserve_bytes, 0, Math.floor(BUDGETS.max_queue_bytes / 2)),
    shutdownTimeoutMs: intFromEnv('OBS_LOG_SHUTDOWN_TIMEOUT_MS', BUDGETS.shutdown_drain_ms, 100, 30000),
    ...overrides,
  };
}

/** Credit accounting: outstanding (events, bytes) with an ERROR/FATAL reserve that lower levels cannot consume. */
class Admission {
  events = 0;
  bytes = 0;
  constructor(
    private readonly maxEvents: number,
    private readonly maxBytes: number,
    private readonly errorReserveBytes: number,
  ) {}
  tryAdmit(bytes: number, severity: SeverityText): boolean {
    if (this.events + 1 > this.maxEvents) return false;
    const isError = severityAtLeast(severity, 'ERROR');
    const cap = isError ? this.maxBytes : this.maxBytes - this.errorReserveBytes;
    return this.bytes + bytes <= cap;
  }
  admit(bytes: number): void {
    this.events += 1;
    this.bytes += bytes;
  }
  release(events: number, bytes: number): void {
    this.events = Math.max(0, this.events - events);
    this.bytes = Math.max(0, this.bytes - bytes);
  }
}

interface PendingAcks {
  events: number;
  bytes: number;
}

class Writer {
  private worker: Worker | null = null;
  private restartAttempt = 0;
  private restarting = false;
  private shuttingDown = false;
  private ended = false;
  private generation = 0;
  private endWaiters: Array<() => void> = [];
  private readonly admission: Admission;
  readonly counters: LogMetrics = {
    attempted_total: 0,
    admitted_total: 0,
    written_total: 0,
    dropped_total: 0,
    invalid_total: 0,
    pending_events: 0,
    pending_bytes: 0,
    writer_up: 0,
    writer_restarts_total: 0,
    shutdown_dropped_total: 0,
    dropped_by_reason: {},
    dropped_by_severity: {},
  };

  constructor(
    private readonly workerPath: string,
    private readonly maxEvents: number,
    private readonly maxBytes: number,
    errorReserveBytes: number,
    private readonly workerEnv?: NodeJS.ProcessEnv,
  ) {
    this.admission = new Admission(maxEvents, maxBytes, errorReserveBytes);
    this.spawn();
  }

  get up(): boolean {
    return this.worker !== null && !this.shuttingDown && !this.ended;
  }

  private spawn(): void {
    try {
      this.generation += 1;
      this.worker = new Worker(this.workerPath, {
        env: { ...this.workerEnv, OBS_SINK_MAX_BYTES: String(this.maxBytes) },
      });
      this.counters.writer_up = 1;
      this.worker.unref();
      // A spawn that survives this window proves stability: consecutive-failure counting resets.
      const gen = this.generation;
      const stability = setTimeout(() => {
        if (this.generation === gen && this.worker) this.restartAttempt = 0;
      }, 30_000);
      stability.unref?.();
    } catch {
      this.worker = null;
      this.counters.writer_up = 0;
      this.scheduleRestart();
      return;
    }
    const gen = this.generation;
    this.worker.on('message', (m: { t: string; gen?: number; n: number; b: number; reason?: string }) => {
      if (m.gen !== undefined && m.gen !== gen) return; // stale message from a dead generation
      if (m.t === 'ack') {
        this.admission.release(m.n, m.b);
        this.counters.written_total += m.n;
      } else if (m.t === 'drop') {
        this.admission.release(m.n, m.b);
        this.countDrops(m.n, m.reason ?? 'write_error');
      } else if (m.t === 'ended') {
        this.ended = true;
        this.counters.writer_up = 0;
        for (const w of this.endWaiters.splice(0)) w();
      }
    });
    this.worker.on('error', () => this.handleWorkerDeath());
    this.worker.on('exit', (code) => {
      if (this.ended || this.shuttingDown) return;
      if (code !== 0) this.handleWorkerDeath();
    });
  }

  private handleWorkerDeath(): void {
    if (this.worker) {
      this.counters.writer_restarts_total += 1;
    }
    this.worker = null;
    this.counters.writer_up = 0;
    this.dropInFlight('writer_lost');
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.shuttingDown || this.restarting) return;
    if (this.restartAttempt >= RESTART_DELAYS_MS.length) return; // writer stays down; drops counted
    this.restarting = true;
    const delay = RESTART_DELAYS_MS[this.restartAttempt];
    this.restartAttempt += 1;
    const timer = setTimeout(() => {
      this.restarting = false;
      if (!this.shuttingDown && !this.ended) this.spawn();
    }, delay);
    timer.unref?.();
  }

  /** Pre-gate before expensive envelope building (plan §5.2.1). */
  isSaturated(severity: SeverityText): boolean {
    return !this.admission.tryAdmit(1, severity);
  }

  dispatch(line: string, bytes: number, severity: SeverityText): boolean {
    if (!this.admission.tryAdmit(bytes, severity)) return false;
    this.admission.admit(bytes);
    this.counters.admitted_total += 1;
    this.worker?.postMessage({ t: 'w', gen: this.generation, lines: [line] });
    return true;
  }

  countDrops(events: number, reason: string): void {
    this.counters.dropped_total += events;
    this.counters.dropped_by_reason[reason] = (this.counters.dropped_by_reason[reason] ?? 0) + events;
  }

  /** Shed one event that was attempted but never admitted (pre-gate or capacity). */
  countDrop(severity: SeverityText, reason: string): void {
    this.counters.dropped_total += 1;
    this.counters.dropped_by_severity[severity] = (this.counters.dropped_by_severity[severity] ?? 0) + 1;
    this.counters.dropped_by_reason[reason] = (this.counters.dropped_by_reason[reason] ?? 0) + 1;
  }

  countInvalid(): void {
    this.counters.invalid_total += 1;
  }

  dropInFlight(reason: string): void {
    const lost = this.admission.events;
    if (lost > 0) {
      this.countDrops(lost, reason);
      this.admission.release(lost, this.admission.bytes);
    }
  }

  get pending(): PendingAcks {
    return { events: this.admission.events, bytes: this.admission.bytes };
  }

  /** Bounded drain: wait for acks + clean worker end, or abandon at the deadline. */
  shutdown(timeoutMs: number): Promise<void> {
    this.shuttingDown = true;
    this.counters.writer_up = 0;
    if (this.worker && !this.ended) this.worker.postMessage({ t: 'end' });
    const started = Date.now();
    return new Promise<void>((resolve) => {
      const finish = () => {
        const remaining = this.admission.events;
        if (remaining > 0) {
          this.counters.shutdown_dropped_total += remaining;
          this.countDrops(remaining, 'shutdown');
          this.admission.release(remaining, this.admission.bytes);
        }
        this.worker?.terminate();
        resolve();
      };
      if (!this.worker || this.ended) {
        finish();
        return;
      }
      const check = setInterval(() => {
        if ((this.admission.events === 0 && this.ended) || Date.now() - started >= timeoutMs) {
          clearInterval(check);
          finish();
        }
      }, 20);
      this.endWaiters.push(() => {
        clearInterval(check);
        finish();
      });
    });
  }
}

class ChildLogger implements ObservabilityLogger {
  constructor(
    private readonly writer: Writer,
    private readonly config: LoggerConfig,
    private readonly bindings: Partial<ContextSnapshot>,
    private readonly nextSequence: () => number,
  ) {}

  debug(name: string, attrs?: LogAttrs): void {
    this.emit('DEBUG', name, attrs);
  }
  info(name: string, attrs?: LogAttrs): void {
    this.emit('INFO', name, attrs);
  }
  warn(name: string, attrs?: LogAttrs): void {
    this.emit('WARN', name, attrs);
  }
  error(name: string, attrs?: LogAttrs): void {
    this.emit('ERROR', name, attrs);
  }
  fatal(name: string, attrs?: LogAttrs): void {
    this.emit('FATAL', name, attrs);
  }

  isEnabled(level: SeverityText): boolean {
    return severityAtLeast(level, this.config.minLevel);
  }

  child(bindings: Partial<ContextSnapshot>): ObservabilityLogger {
    return new ChildLogger(this.writer, this.config, { ...this.bindings, ...bindings }, this.nextSequence);
  }

  shutdown(timeoutMs?: number): Promise<void> {
    return this.writer.shutdown(timeoutMs ?? this.config.shutdownTimeoutMs);
  }

  metricsSnapshot(): LogMetrics {
    const snapshot = {
      ...this.writer.counters,
      dropped_by_reason: { ...this.writer.counters.dropped_by_reason },
      dropped_by_severity: { ...this.writer.counters.dropped_by_severity },
    };
    const pending = this.writer.pending;
    snapshot.pending_events = pending.events;
    snapshot.pending_bytes = pending.bytes;
    return snapshot;
  }

  private emit(severity: SeverityText, eventName: string, attrs?: LogAttrs): void {
    if (!this.isEnabled(severity)) return;
    const counters = this.writer.counters;
    counters.attempted_total += 1;
    if (!this.writer.up) {
      this.writer.countDrop(severity, 'writer_down');
      return;
    }
    if (this.writer.isSaturated(severity)) {
      // Shed before building the envelope (plan §5.2.1); error reserve is respected inside isSaturated.
      this.writer.countDrop(severity, 'capacity');
      return;
    }

    let context: ContextSnapshot = {};
    try {
      context = { ...(this.config.contextReader?.() ?? {}), ...this.bindings };
    } catch {
      context = { ...this.bindings }; // a failing context reader must never reach the caller
    }
    const identity: EnvelopeInput['identity'] = {
      serviceName: this.config.serviceName,
      serviceVersion: this.config.serviceVersion,
      environment: this.config.environment,
      serviceInstanceId: this.config.serviceInstanceId,
      bootId: this.config.serviceInstanceId,
      sequence: this.nextSequence(),
    };
    const built = buildEnvelope(
      { eventName, severity, attrs, context, identity },
      this.config.maxEventBytes,
    );
    if ('invalid' in built) {
      this.writer.countInvalid();
      const invalidEvent = buildInvalidEvent(identity, 'WARN', built.invalid, eventName);
      if (eventName !== 'logger.event.invalid') this.writer.dispatch(invalidEvent.line, invalidEvent.bytes, 'WARN');
      return;
    }
    if (!this.writer.dispatch(built.line, built.bytes, severity)) {
      this.writer.countDrop(severity, 'capacity');
    }
  }
}

export class LoggerImpl implements ObservabilityLogger {
  private readonly writer: Writer;
  private sequence = 0;
  private readonly root: ChildLogger;

  constructor(config: LoggerConfig) {
    const workerPath = config.workerPath ?? join(dirname(__filename), 'worker.cjs');
    this.writer = new Writer(
      workerPath,
      config.maxQueueEvents,
      config.maxQueueBytes,
      config.errorReserveBytes,
      (config as LoggerConfig & { workerEnv?: NodeJS.ProcessEnv }).workerEnv,
    );
    this.root = new ChildLogger(this.writer, config, {}, () => this.sequence++);
  }

  debug(name: string, attrs?: LogAttrs): void {
    this.root.debug(name, attrs);
  }
  info(name: string, attrs?: LogAttrs): void {
    this.root.info(name, attrs);
  }
  warn(name: string, attrs?: LogAttrs): void {
    this.root.warn(name, attrs);
  }
  error(name: string, attrs?: LogAttrs): void {
    this.root.error(name, attrs);
  }
  fatal(name: string, attrs?: LogAttrs): void {
    this.root.fatal(name, attrs);
  }
  isEnabled(level: SeverityText): boolean {
    return this.root.isEnabled(level);
  }
  child(bindings: Partial<ContextSnapshot>): ObservabilityLogger {
    return this.root.child(bindings);
  }
  shutdown(timeoutMs?: number): Promise<void> {
    return this.root.shutdown(timeoutMs);
  }
  metricsSnapshot(): LogMetrics {
    return this.root.metricsSnapshot();
  }
}

let singleton: LoggerImpl | null = null;

/** One writer per process: later calls return the existing logger (config ignored). */
export function createLogger(overrides?: Partial<LoggerConfig>): ObservabilityLogger {
  if (!singleton) singleton = new LoggerImpl(configFromEnv(overrides));
  return singleton;
}

/** Test isolation hook: always creates a fresh instance without touching the singleton. */
export function _createForTests(overrides?: Partial<LoggerConfig>): ObservabilityLogger {
  const impl = new LoggerImpl(configFromEnv(overrides));
  (impl as ObservabilityLogger & { __writer?: Writer }).__writer = impl['writer'];
  return impl;
}
