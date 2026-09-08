import type { ConversationLatencyQuality, ConversationLatencyMetricsV1, StreamChunkLatencyData } from '../types';

/** Upper bound for a plausible single-stage duration; mirrors the backend. */
export const MAX_PLAUSIBLE_STAGE_MS = 60_000;
/** Small negative drift (clock jitter) clamped to 0 instead of being discarded. */
const CLOCK_JITTER_TOLERANCE_MS = -5;

export interface FrontendPaintSample {
  /** performance.now() captured in the second animation frame after commit. */
  paintedPerfMs: number;
  timeOrigin: number;
  /** Epoch ms stamped by the backend immediately before SSE fan-out. */
  backendFirstDeltaWrittenEpochMs: number;
  /** performance.now() captured when the latency envelope chunk arrived. */
  firstChunkReceivedPerfMs: number;
}

export interface FrontendPaintComputation {
  /** Undefined when cross-clock validation rejects the epoch delta. */
  frontendRenderMs?: number;
  frontendFirstChunkPaintedEpochMs?: number;
  browserRenderOnlyMs: number;
  quality: ConversationLatencyQuality;
}

/**
 * Compute the sixth latency metric from the browser paint sample.
 * `frontendRenderMs` spans the backend→browser clock domains and is therefore
 * validated with the cross-clock policy; `browserRenderOnlyMs` stays on the
 * browser's monotonic clock and is diagnostic only.
 */
export function computeFrontendLatency(
  sample: FrontendPaintSample,
  serverQuality: ConversationLatencyQuality,
): FrontendPaintComputation {
  const paintedEpochMs = sample.timeOrigin + sample.paintedPerfMs;
  const browserRenderOnlyMs = Math.max(0, sample.paintedPerfMs - sample.firstChunkReceivedPerfMs);

  let quality: ConversationLatencyQuality = serverQuality;
  let frontendRenderMs: number | undefined;
  const rawDelta = paintedEpochMs - sample.backendFirstDeltaWrittenEpochMs;
  if (Number.isFinite(rawDelta) && rawDelta >= 0 && rawDelta <= MAX_PLAUSIBLE_STAGE_MS) {
    frontendRenderMs = rawDelta;
  } else if (Number.isFinite(rawDelta) && rawDelta < 0 && rawDelta >= CLOCK_JITTER_TOLERANCE_MS) {
    frontendRenderMs = 0;
    quality = 'clock-skew';
  } else {
    // Implausible cross-process value — do not display a number.
    quality = 'clock-skew';
  }

  return {
    ...(frontendRenderMs !== undefined
      ? { frontendRenderMs, frontendFirstChunkPaintedEpochMs: paintedEpochMs }
      : {}),
    browserRenderOnlyMs,
    quality,
  };
}

/** Merge the browser-computed sixth metric into the server's first five. */
export function mergeLatencyMetrics(
  server: StreamChunkLatencyData['metrics'],
  computed: FrontendPaintComputation,
): ConversationLatencyMetricsV1 {
  return {
    schemaVersion: 1,
    ...server,
    frontendRenderMs: computed.frontendRenderMs,
    browserRenderOnlyMs: computed.browserRenderOnlyMs,
    quality: computed.quality,
  };
}
