/**
 * Runtime-only client streaming metrics for the latency instrumentation
 * (Phase 0 telemetry). Counters accumulate across one send→complete cycle
 * and are snapshotted when the store submits the latency report at stream
 * completion; they are never persisted client-side.
 *
 * Values are clamped to the backend DTO bounds at record time. The collector
 * is intentionally dependency-free so renderers and the ingestion buffer can
 * import it without import cycles. It is a module singleton: concurrent sends
 * in background tabs share one window, which is acceptable for aggregate
 * baseline telemetry.
 */
export interface ClientStreamMetrics {
  /** Store sendMessage entry → POST dispatch. */
  clickToPostMs?: number;
  /** Total Shiki codeToHtml invocations in the window (must stay 0 during active streaming). */
  shikiHighlightCalls?: number;
  /** Accumulated wall time of codeToHtml calls. */
  shikiHighlightMs?: number;
  /** Largest code input highlighted, in characters. */
  shikiHighlightMaxChars?: number;
  /** Ingestion queue: raw events accepted. */
  queueEventsReceived?: number;
  /** Ingestion queue: flush commits performed. */
  queueFlushes?: number;
  /** Ingestion queue: events applied via flush batches (events minus sync drains). */
  queueCoalescedEvents?: number;
  /** Deepest the pending queue grew. */
  queueMaxDepth?: number;
  /** Slowest flush-callback application, in milliseconds. */
  queueMaxFlushDurationMs?: number;
  /** Store transactions produced by the ingestion path. */
  storeCommits?: number;
}

const MAX_VALUE_MS = 60_000;
const MAX_COUNT = 1_000_000;

const clampMs = (value: number): number => Math.max(0, Math.min(MAX_VALUE_MS, Math.round(value)));
const clampCount = (value: number): number => Math.max(0, Math.min(MAX_COUNT, Math.round(value)));

class ClientStreamMetricsCollector {
  private clickToPostMs?: number;
  private shikiHighlightCalls = 0;
  private shikiHighlightMs = 0;
  private shikiHighlightMaxChars = 0;
  private queueEventsReceived = 0;
  private queueFlushes = 0;
  private queueCoalescedEvents = 0;
  private queueMaxDepth = 0;
  private queueMaxFlushDurationMs = 0;
  private storeCommits = 0;

  /** First measurement in the window wins; later sends in the same window are dropped. */
  recordClickToPost(ms: number): void {
    if (this.clickToPostMs === undefined) this.clickToPostMs = clampMs(ms);
  }

  recordHighlight(inputChars: number, durationMs: number): void {
    this.shikiHighlightCalls = clampCount(this.shikiHighlightCalls + 1);
    this.shikiHighlightMs = clampMs(this.shikiHighlightMs + durationMs);
    this.shikiHighlightMaxChars = clampCount(Math.max(this.shikiHighlightMaxChars, inputChars));
  }

  recordQueueEnqueue(): void {
    this.queueEventsReceived = clampCount(this.queueEventsReceived + 1);
  }

  recordQueueFlush(depth: number, flushDurationMs: number, commits: number): void {
    this.queueFlushes = clampCount(this.queueFlushes + 1);
    this.queueCoalescedEvents = clampCount(this.queueCoalescedEvents + depth);
    this.queueMaxDepth = clampCount(Math.max(this.queueMaxDepth, depth));
    this.queueMaxFlushDurationMs = Math.max(this.queueMaxFlushDurationMs, clampMs(flushDurationMs));
    this.storeCommits = clampCount(this.storeCommits + Math.max(0, commits));
  }

  /** Current window values; null when nothing was recorded. */
  snapshot(): ClientStreamMetrics | null {
    const hasAny =
      this.clickToPostMs !== undefined ||
      this.shikiHighlightCalls > 0 ||
      this.queueEventsReceived > 0;
    if (!hasAny) return null;
    return {
      ...(this.clickToPostMs !== undefined ? { clickToPostMs: this.clickToPostMs } : {}),
      ...(this.shikiHighlightCalls > 0
        ? {
            shikiHighlightCalls: this.shikiHighlightCalls,
            shikiHighlightMs: this.shikiHighlightMs,
            shikiHighlightMaxChars: this.shikiHighlightMaxChars,
          }
        : {}),
      ...(this.queueEventsReceived > 0
        ? {
            queueEventsReceived: this.queueEventsReceived,
            queueFlushes: this.queueFlushes,
            queueCoalescedEvents: this.queueCoalescedEvents,
            queueMaxDepth: this.queueMaxDepth,
            queueMaxFlushDurationMs: this.queueMaxFlushDurationMs,
            storeCommits: this.storeCommits,
          }
        : {}),
    };
  }

  snapshotAndReset(): ClientStreamMetrics | null {
    const snapshot = this.snapshot();
    this.reset();
    return snapshot;
  }

  reset(): void {
    this.clickToPostMs = undefined;
    this.shikiHighlightCalls = 0;
    this.shikiHighlightMs = 0;
    this.shikiHighlightMaxChars = 0;
    this.queueEventsReceived = 0;
    this.queueFlushes = 0;
    this.queueCoalescedEvents = 0;
    this.queueMaxDepth = 0;
    this.queueMaxFlushDurationMs = 0;
    this.storeCommits = 0;
  }
}

export const streamMetrics = new ClientStreamMetricsCollector();
