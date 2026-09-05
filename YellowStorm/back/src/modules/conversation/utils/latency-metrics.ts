import type {
  AdkLatencyTracePayload,
  ConversationLatencyMetricsV1,
  ConversationLatencyStartContext,
  StreamChunkLatencyData,
} from '../interfaces/latency.interface';
import {
  sanitizeMonotonicDurationMs,
  validateCrossClockDurationMs,
} from '../interfaces/latency.interface';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Extract the ADK latency trace from a gRPC StreamChunk as mapped by
 * proto-loader (keepCase: true → snake_case keys). Returns null when the chunk
 * carries no trace or the trace lacks its mandatory ADK receipt timestamp.
 */
export function parseAdkLatencyTrace(chunk: unknown): AdkLatencyTracePayload | null {
  const trace = (chunk as { latency_trace?: unknown } | null | undefined)?.latency_trace;
  if (!trace || typeof trace !== 'object') return null;
  const payload = trace as AdkLatencyTracePayload;
  return isFiniteNumber(payload.adk_request_received_epoch_ms) ? payload : null;
}

/**
 * Compute the first five latency metrics from the ADK trace envelope plus the
 * backend context. Cross-clock durations are validated per the clock policy;
 * ADK-local monotonic durations are trusted after a finite/non-negative check.
 */
export function computeServerLatencyMetrics(
  latencyStart: ConversationLatencyStartContext,
  trace: AdkLatencyTracePayload,
  backendFirstDeltaWrittenEpochMs: number,
): Pick<StreamChunkLatencyData, 'metrics' | 'quality'> {
  const metrics: StreamChunkLatencyData['metrics'] = {};
  let sawClockSkew = false;
  let sawMissing = false;

  const markCrossClock = (
    key: 'backendPreAdkMs' | 'backendForwardingMs',
    rawValue: number | undefined,
  ): void => {
    if (!isFiniteNumber(rawValue)) {
      sawMissing = true;
      return;
    }
    const validated = validateCrossClockDurationMs(rawValue);
    if (validated.quality === 'clock-skew') sawClockSkew = true;
    if (validated.value !== undefined) metrics[key] = validated.value;
  };

  const markMonotonic = (
    key: 'adkPreProviderMs' | 'providerTtftMs' | 'adkForwardingMs',
    rawValue: unknown,
  ): void => {
    const value = sanitizeMonotonicDurationMs(rawValue);
    if (value === undefined) sawMissing = true;
    else metrics[key] = value;
  };

  markCrossClock(
    'backendPreAdkMs',
    trace.adk_request_received_epoch_ms !== undefined
      ? trace.adk_request_received_epoch_ms - latencyStart.backendReceivedEpochMs
      : undefined,
  );
  markMonotonic('adkPreProviderMs', trace.adk_pre_provider_ms);
  markMonotonic('providerTtftMs', trace.provider_ttft_ms);
  markMonotonic('adkForwardingMs', trace.adk_forwarding_ms);
  markCrossClock(
    'backendForwardingMs',
    isFiniteNumber(trace.adk_first_delta_forwarded_epoch_ms)
      ? backendFirstDeltaWrittenEpochMs - trace.adk_first_delta_forwarded_epoch_ms
      : undefined,
  );

  const quality = sawClockSkew ? 'clock-skew' : sawMissing ? 'partial' : 'ok';
  return { metrics, quality };
}

/**
 * Assemble the one-time SSE latency envelope for the first model-derived chunk.
 * `backendFirstDeltaWrittenEpochMs` must be captured immediately before the
 * broadcast call that carries this envelope.
 */
export function buildStreamChunkLatencyData(
  latencyStart: ConversationLatencyStartContext,
  trace: AdkLatencyTracePayload,
  backendFirstDeltaWrittenEpochMs: number,
): StreamChunkLatencyData {
  const { metrics, quality } = computeServerLatencyMetrics(
    latencyStart,
    trace,
    backendFirstDeltaWrittenEpochMs,
  );
  return {
    schemaVersion: 1,
    requestId: latencyStart.requestId ?? '',
    assistantMessageId: latencyStart.assistantMessageId ?? '',
    backendFirstDeltaWrittenEpochMs,
    metrics,
    quality,
  };
}

/**
 * Per-stream state machine guaranteeing the ADK latency trace is captured from
 * exactly one chunk and the SSE envelope is attached to exactly one broadcast.
 * `take()` stamps the backend write boundary via `now()` — call it immediately
 * before the broadcast that will carry the envelope.
 */
export class LatencyEnvelopeTracker {
  private pending: AdkLatencyTracePayload | null = null;
  private sent = false;

  constructor(
    private readonly latencyStart: ConversationLatencyStartContext | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /** Inspect an incoming gRPC chunk for the one-time ADK trace. */
  capture(chunk: unknown): void {
    if (this.sent || this.pending !== null) return;
    if (!this.latencyStart?.assistantMessageId) return;
    this.pending = parseAdkLatencyTrace(chunk);
  }

  /** Return the envelope for the chunk being broadcast, at most once. */
  take(): StreamChunkLatencyData | undefined {
    if (!this.pending || !this.latencyStart?.assistantMessageId) return undefined;
    const envelope = buildStreamChunkLatencyData(this.latencyStart, this.pending, this.now());
    this.pending = null;
    this.sent = true;
    return envelope;
  }
}
