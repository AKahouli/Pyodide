import { mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { _createForTests, createLogger } from '../src/logger';
import { buildEnvelope } from '../src/envelope';
import { boundedDetail } from '../src/redact';
import { EVENT_REGISTRY } from '../src/contract';
import type { EnvelopeInput } from '../src/envelope';
import schema from '../../contracts/observability/log-event.v1.schema.json';

const ajv = new Ajv2020({ strict: false });
const validate = ajv.compile(schema as object);

const identity: EnvelopeInput['identity'] = {
  serviceName: 'test-service',
  serviceVersion: 'test',
  environment: 'local',
  serviceInstanceId: 'boot-test-01',
  bootId: 'boot-test-01',
  sequence: 1,
};

const worker = (name: string) => join(__dirname, name === 'real' ? '../src/worker.cjs' : 'fixtures/fake-worker.cjs');

function makeLogger(overrides: Record<string, unknown> = {}) {
  return _createForTests({
    serviceName: 'test-service',
    serviceVersion: 'test',
    environment: 'local',
    serviceInstanceId: 'boot-test-01',
    workerPath: worker('fake'),
    minLevel: 'TRACE',
    ...overrides,
  } as never);
}

describe('P01 contract conformance (T01/T02)', () => {
  it('valid registry events produce schema-valid lines', () => {
    for (const [name, def] of Object.entries(EVENT_REGISTRY)) {
      const attrs: Record<string, unknown> = {};
      for (const attr of def.attributes) attrs[attr] = attr.includes('ms') || attr.includes('count') || attr === 'attempt' ? 1 : 'x';
      const built = buildEnvelope({ eventName: name, severity: 'INFO', attrs, identity });
      expect(built, name).toHaveProperty('line');
      expect(validate(JSON.parse((built as { line: string }).line)), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('all invalid fixtures fail schema validation', () => {
    const dir = join(__dirname, '../../../contracts/observability/fixtures/invalid');
    for (const file of readdirSync(dir)) {
      const event = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      expect(validate(event), `${file} should be invalid`).toBe(false);
    }
  });

  it('valid fixtures pass schema validation', () => {
    const dir = join(__dirname, '../../../contracts/observability/fixtures/valid');
    for (const file of readdirSync(dir)) {
      const event = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      expect(validate(event), `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('severity numbers match the OTel base values', () => {
    const checks: Array<[string, number]> = [['TRACE', 1], ['DEBUG', 5], ['INFO', 9], ['WARN', 13], ['ERROR', 17], ['FATAL', 21]];
    for (const [sev, num] of checks) {
      const built = buildEnvelope({ eventName: 'service.started', severity: sev as never, identity });
      const event = JSON.parse((built as { line: string }).line);
      expect(event.severity_number).toBe(num);
      expect(event.severity_text).toBe(sev);
    }
  });

  it('invalid/missing trace context is omitted, never fabricated (T02)', () => {
    const built = buildEnvelope({
      eventName: 'service.started',
      severity: 'INFO',
      identity,
      context: { trace_id: '00000000000000000000000000000000', span_id: 'nothex', user_id: 'u1' },
    });
    const event = JSON.parse((built as { line: string }).line);
    expect(event.trace_id).toBeUndefined();
    expect(event.span_id).toBeUndefined();
    expect(event.user_id).toBe('u1');
    expect(validate(event)).toBe(true);
  });

  it('unknown event names are rejected and surfaced via logger.event.invalid', () => {
    const logger = makeLogger();
    logger.error('made.up.event', { tool_name: 'x' });
    const m = logger.metricsSnapshot();
    expect(m.invalid_total).toBe(1);
    expect(m.dropped_total).toBe(0);
    logger.shutdown(200);
  });
});

describe('P02 SDK bounds and safety (T03/T05/T06)', () => {
  it('hostile values never throw and stay under the event cap (T03)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const hostileObj: Record<string, unknown> = { a: 1 };
    Object.defineProperty(hostileObj, 'boom', { get() { throw new Error('boom'); }, enumerable: true });
    const cases: Array<Record<string, unknown>> = [
      { circular },
      { big: 'x'.repeat(1048576) },
      { nan: NaN, inf: -Infinity },
      { [Symbol('sym')]: 'x' } as never,
    ];
    for (const attrs of cases) {
      expect(() => buildEnvelope({ eventName: 'tool.call.failed', severity: 'ERROR', attrs, identity })).not.toThrow();
      const built = buildEnvelope({ eventName: 'tool.call.failed', severity: 'ERROR', attrs, identity });
      if (built && 'line' in built) {
        expect(Buffer.byteLength(built.line, 'utf8')).toBeLessThanOrEqual(8192);
        expect(validate(JSON.parse(built.line))).toBe(true);
      }
    }
    expect(() =>
      buildEnvelope({ eventName: 'tool.call.failed', severity: 'ERROR', attrs: hostileObj, identity }),
    ).not.toThrow();
  });

  it('bigint attributes are stringified and remain valid', () => {
    const built = buildEnvelope({ eventName: 'llm.call.completed', severity: 'INFO', attrs: { usage_input_tokens: 2n ** 64n }, identity });
    const event = JSON.parse((built as { line: string }).line);
    expect(event.attributes.usage_input_tokens).toBe('18446744073709551616');
    expect(validate(event)).toBe(true);
  });

  it('caller-owned objects are not retained by reference (T05)', () => {
    const attrs = { detail: 'before' };
    const built = buildEnvelope({ eventName: 'legacy.log', severity: 'DEBUG', attrs, identity });
    attrs.detail = 'after';
    expect((built as { line: string }).line).toContain('before');
  });

  it('oversized events degrade deterministically and preserve identity', () => {
    const bigAttrs = { detail: 'y'.repeat(9000) };
    const built = buildEnvelope(
      { eventName: 'tool.call.failed', severity: 'ERROR', attrs: { ...bigAttrs, error: new Error('x'.repeat(9000)) }, identity },
      2048,
    );
    const event = JSON.parse((built as { line: string }).line);
    expect(Buffer.byteLength((built as { line: string }).line)).toBeLessThanOrEqual(2048);
    expect(event.event_name).toBe('tool.call.failed');
    expect(event.service_name).toBe('test-service');
    expect(event.timestamp).toBeDefined();
    expect(event.truncated_fields).toBeDefined();
  });

  it('isEnabled gates before any work (T06)', () => {
    const logger = makeLogger({ minLevel: 'WARN' } as never);
    logger.debug('legacy.log', { detail: 'nope' });
    logger.info('service.started');
    const m = logger.metricsSnapshot();
    expect(m.attempted_total).toBe(0);
    expect(logger.isEnabled('WARN')).toBe(true);
    expect(logger.isEnabled('DEBUG')).toBe(false);
    logger.shutdown(200);
  });

  it('redacts sensitive keys and credential-shaped strings (T04)', () => {
    const built = buildEnvelope({
      eventName: 'dependency.request.failed',
      severity: 'ERROR',
      attrs: {
        password: 'hunter2',
        api_key: 'sk-123',
        detail: 'postgres://user:secret@db:5432/yellow?password=x Authorization: Bearer abc.def',
      },
      identity,
    });
    const line = (built as { line: string }).line;
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('sk-123');
    expect(line).not.toContain('secret@db');
    expect(line).not.toContain('Bearer abc');
    expect(validate(JSON.parse(line))).toBe(true);
  });

  it('boundedDetail summarizes legacy objects safely', () => {
    const obj = { password: 'x', nested: { token: 'y', ok: 1 }, arr: [1, 'a'], big: 'z'.repeat(2000) };
    const out = boundedDetail(obj)!;
    expect(out.length).toBeLessThanOrEqual(512);
    expect(out).toContain('"password":"[REDACTED]"');
    expect(out).toContain('"token":"[REDACTED]"');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => boundedDetail(cyclic)).not.toThrow();
  });
});

describe('P02 admission, worker lifecycle, shutdown (T08/T09/T11)', () => {
  it('regular capacity cannot consume the error reserve; errors still flow (T09)', () => {
    const logger = makeLogger({ maxQueueBytes: 4096, errorReserveBytes: 1024, maxQueueEvents: 1000 } as never);
    for (let i = 0; i < 50; i++) logger.info('service.started', { launcher: 'l'.repeat(100) }); // ~200B each
    const m1 = logger.metricsSnapshot();
    expect(m1.dropped_total).toBeGreaterThan(0);
    const pendingAfterRegular = m1.pending_events;
    logger.error('tool.call.failed', { attempt: 1 });
    const m2 = logger.metricsSnapshot();
    expect(m2.pending_events).toBe(pendingAfterRegular + 1); // error reserve still admits
    expect(m2.pending_bytes).toBeLessThanOrEqual(4096);
    logger.shutdown(200);
  });

  it('worker death is counted, credits released, restarts scheduled (T08)', async () => {
    const logger = makeLogger({ workerPath: worker('fake') } as never);
    logger.info('service.started');
    const mBefore = logger.metricsSnapshot();
    expect(mBefore.pending_events).toBe(1);
    // force worker death through the internal channel: send 'die' then a new event
    (logger as unknown as { writer: { worker: { postMessage: (m: object) => void } } }).writer.worker.postMessage({ t: 'die' });
    await new Promise((r) => setTimeout(r, 250));
    const mAfter = logger.metricsSnapshot();
    expect(mAfter.writer_restarts_total).toBeGreaterThan(0);
    expect(mAfter.pending_events).toBe(0); // credits released on death
    expect(mAfter.dropped_by_reason.writer_lost).toBe(1);
    logger.shutdown(500);
  });

  it('shutdown respects the deadline and counts abandoned work (T11)', async () => {
    const logger = makeLogger();
    logger.info('service.started');
    const started = Date.now();
    await logger.shutdown(150);
    expect(Date.now() - started).toBeLessThan(1000);
    const m = logger.metricsSnapshot();
    expect(m.shutdown_dropped_total).toBe(1);
    expect(m.pending_events).toBe(0);
  });

  it('real worker writes valid JSON lines to the configured fd (T01 e2e)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'obs-test-'));
    const file = join(dir, 'events.log');
    const fd = openSync(file, 'w');
    try {
      const logger = makeLogger({ workerPath: worker('real'), workerEnv: { OBS_WRITER_FD: String(fd) } } as never);
      logger.info('service.started', { launcher: 'vitest' });
      logger.error('tool.call.failed', { attempt: 1, error: new Error('e2e failure') });
      await logger.shutdown(1000);
      const content = readFileSync(file, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
      for (const line of lines) {
        expect(validate(JSON.parse(line)), line).toBe(true);
      }
      expect(JSON.parse(lines[1]).error.type).toBe('Error');
      expect(JSON.parse(lines[1]).error.stack).not.toContain(process.cwd() + '/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('periodic flush delivers quiet-service events without shutdown (bounded delay)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'obs-test-'));
    const file = join(dir, 'events.log');
    const fd = openSync(file, 'w');
    try {
      const logger = makeLogger({ workerPath: worker('real'), workerEnv: { OBS_WRITER_FD: String(fd) } } as never);
      logger.info('service.started', { launcher: 'vitest' });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      expect(lines.length, 'flush timer must deliver buffered events within ~1s').toBe(1);
      expect(JSON.parse(lines[0]).event_name).toBe('service.started');
      await logger.shutdown(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('repeated createLogger returns one writer per process (T07)', () => {
    const a = createLogger();
    const b = createLogger();
    expect(a).toBe(b);
    a.shutdown(100);
  });
});
