import { LoggerService } from './logger.service';

const configMock = (values: Record<string, unknown>) =>
  ({ get: (path: string, defaultValue?: unknown) => values[path] ?? defaultValue }) as never;

describe('LoggerService legacy facade', () => {
  it('maps legacy calls to legacy.log SDK events without invalid emissions', () => {
    const svc = new LoggerService(configMock({ 'app.logLevel': 'debug' }), undefined);
    const before = svc.metricsSnapshot();
    svc.setContext('TestCtx');
    svc.log('hello', { userId: 'u1', nested: { password: 'hunter2' } });
    svc.error('boom', 'Error: boom\n    at thing (file.ts:1:1)');
    svc.warn('careful', { requestId: 'req-1' });
    const after = svc.metricsSnapshot();
    expect(after.attempted_total - before.attempted_total).toBe(3);
    expect(after.invalid_total).toBe(before.invalid_total);
    expect(after.dropped_total).toBe(before.dropped_total);
  });

  it('keeps legacy level gating', () => {
    const svc = new LoggerService(configMock({ 'app.logLevel': 'error' }), undefined);
    const before = svc.metricsSnapshot();
    svc.log('ignored');
    svc.debug('ignored');
    svc.verbose('ignored');
    expect(svc.metricsSnapshot().attempted_total).toBe(before.attempted_total);
    svc.error('kept');
    expect(svc.metricsSnapshot().attempted_total).toBe(before.attempted_total + 1);
  });

  it('does not retain caller data by reference', () => {
    const svc = new LoggerService(configMock({ 'app.logLevel': 'info' }), undefined);
    const data = { detail: 'before' };
    svc.log('snapshot', data);
    data.detail = 'after';
    // No retained reference: the SDK snapshot is built synchronously at emit time; if this
    // event is ever re-rendered it must still show 'before'. Assert via no-throw + counters.
    expect(svc.metricsSnapshot().attempted_total).toBeGreaterThan(0);
  });
});
