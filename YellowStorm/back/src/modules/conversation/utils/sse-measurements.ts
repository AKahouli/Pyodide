/** Fixed cardinality and memory: no recipient, connection or payload labels. */
export const SSE_DURATION_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000] as const;
export type SseMeasurement = 'poll' | 'lock' | 'flush' | 'queue_commit' | 'cleanup';

export class SseMeasurements {
  private readonly histograms = new Map<SseMeasurement, { count: number; sum: number; buckets: number[] }>();
  private readonly counters = new Map<string, number>();

  observe(operation: SseMeasurement, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    let histogram = this.histograms.get(operation);
    if (!histogram) {
      histogram = { count: 0, sum: 0, buckets: Array(SSE_DURATION_BUCKETS_MS.length + 1).fill(0) };
      this.histograms.set(operation, histogram);
    }
    histogram.count++;
    histogram.sum += durationMs;
    const index = SSE_DURATION_BUCKETS_MS.findIndex(bound => durationMs <= bound);
    histogram.buckets[index < 0 ? SSE_DURATION_BUCKETS_MS.length : index]++;
  }

  increment(operation: 'poll_error' | 'flush_error' | 'accepted' | 'rejected' | 'resumed' | 'resync' | 'delivered' | 'withheld' | 'overflow' | 'dropped' | 'global_marker', count = 1): void {
    this.counters.set(operation, (this.counters.get(operation) ?? 0) + count);
  }

  snapshot() {
    return {
      histograms: [...this.histograms].map(([operation, value]) => ({ operation, ...value, buckets: [...value.buckets] })),
      counters: Object.fromEntries(this.counters),
    };
  }
}
