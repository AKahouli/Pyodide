import { computeFrontendLatency, mergeLatencyMetrics } from './latency-paint';
import type { StreamChunkLatencyData } from '../types';

const metricsStub: StreamChunkLatencyData['metrics'] = {
  backendPreAdkMs: 120,
  adkPreProviderMs: 60,
  providerTtftMs: 500,
  adkForwardingMs: 10,
  backendForwardingMs: 15,
  quality: 'ok',
};

describe('computeFrontendLatency', () => {
  it('computes the frontend render delta across clock domains', () => {
    const timeOrigin = 1_000_000;
    const result = computeFrontendLatency(
      {
        paintedPerfMs: 500,
        timeOrigin,
        backendFirstDeltaWrittenEpochMs: timeOrigin + 420,
        firstChunkReceivedPerfMs: 480,
      },
      'ok',
    );
    expect(result.frontendRenderMs).toBe(80);
    expect(result.frontendFirstChunkPaintedEpochMs).toBe(timeOrigin + 500);
    expect(result.browserRenderOnlyMs).toBe(20);
    expect(result.quality).toBe('ok');
  });

  it('keeps the browser-only diagnostic on the monotonic clock', () => {
    const result = computeFrontendLatency(
      {
        paintedPerfMs: 900,
        timeOrigin: 5_000_000,
        backendFirstDeltaWrittenEpochMs: 1, // Cross-clock value rejected below.
        firstChunkReceivedPerfMs: 880,
      },
      'ok',
    );
    expect(result.browserRenderOnlyMs).toBe(20);
  });

  it('clamps small negative drift to zero and flags clock skew', () => {
    const timeOrigin = 1_000_000;
    const result = computeFrontendLatency(
      {
        paintedPerfMs: 500,
        timeOrigin,
        backendFirstDeltaWrittenEpochMs: timeOrigin + 503,
        firstChunkReceivedPerfMs: 490,
      },
      'ok',
    );
    expect(result.frontendRenderMs).toBe(0);
    expect(result.quality).toBe('clock-skew');
  });

  it('rejects implausible cross-process deltas without a displayed value', () => {
    const timeOrigin = 1_000_000;
    const result = computeFrontendLatency(
      {
        paintedPerfMs: 500,
        timeOrigin,
        backendFirstDeltaWrittenEpochMs: timeOrigin - 120_000,
        firstChunkReceivedPerfMs: 480,
      },
      'ok',
    );
    expect(result.frontendRenderMs).toBeUndefined();
    expect(result.frontendFirstChunkPaintedEpochMs).toBeUndefined();
    expect(result.quality).toBe('clock-skew');
  });
});

describe('mergeLatencyMetrics', () => {
  it('produces the full V1 object with the sixth metric', () => {
    const merged = mergeLatencyMetrics(metricsStub, {
      frontendRenderMs: 80,
      frontendFirstChunkPaintedEpochMs: 1_000_500,
      browserRenderOnlyMs: 20,
      quality: 'ok',
    });
    expect(merged).toEqual({
      schemaVersion: 1,
      ...metricsStub,
      frontendRenderMs: 80,
      browserRenderOnlyMs: 20,
      quality: 'ok',
    });
  });

  it('propagates clock-skew quality from the paint computation', () => {
    const merged = mergeLatencyMetrics(metricsStub, {
      browserRenderOnlyMs: 20,
      quality: 'clock-skew',
    });
    expect(merged.frontendRenderMs).toBeUndefined();
    expect(merged.quality).toBe('clock-skew');
  });
});
