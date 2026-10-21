import { SseMeasurements } from './sse-measurements';

describe('bounded SSE aggregate measurements', () => {
  it('retains tail overflow, invalid-sample rejection and immutable snapshots', () => {
    const measurements = new SseMeasurements();
    for (const duration of [0, 1, 500, 20000, NaN, -1]) measurements.observe('poll', duration);
    const snapshot = measurements.snapshot();
    expect(snapshot.histograms[0].count).toBe(4);
    expect(snapshot.histograms[0].sum).toBe(20501);
    expect(snapshot.histograms[0].buckets[0]).toBe(2);
    expect(snapshot.histograms[0].buckets.at(-1)).toBe(1);
    snapshot.histograms[0].buckets[0] = 999;
    expect(measurements.snapshot().histograms[0].buckets[0]).toBe(2);
  });
});
