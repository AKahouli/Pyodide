import { computeFrontendLatency, mergeLatencyMetrics, type FrontendPaintComputation } from './utils/latency-paint';
import type { ConversationLatencyQuality, Message, ReportFrontendLatencyPayload, StreamChunkLatencyData } from './types';

/**
 * Runtime-only first-paint tracking for the latency instrumentation.
 * Set when the one-time latency envelope chunk arrives; never persisted.
 */
export interface PendingLatencyPaint {
  conversationId: string;
  requestId: string;
  messageId: string;
  backendFirstDeltaWrittenEpochMs: number;
  firstChunkReceivedPerfMs: number;
  metrics: StreamChunkLatencyData['metrics'];
  serverQuality: ConversationLatencyQuality;
  measured: boolean;
  computed?: FrontendPaintComputation;
  /** stream_complete arrived before paint was measured (fast completion). */
  completeArrived?: boolean;
}

export interface LatencyCaptureInput {
  conversationId: string;
  firstChunkReceivedPerfMs: number;
  latency: StreamChunkLatencyData;
}

/**
 * Stateful controller behind the conversation store's latency actions.
 * Guarantees per stream: capture-once, measure-once, report-once, and that a
 * report is only submitted for an accepted (cross-clock-validated) measurement.
 * Extracted from the store so the lifecycle is unit-testable without pulling
 * in the full store import graph.
 */
export function createLatencyPaintController() {
  let pending: PendingLatencyPaint | null = null;

  return {
    get pending(): PendingLatencyPaint | null {
      return pending;
    },

    /** First-write-wins capture of the one-time SSE latency envelope. */
    capture(input: LatencyCaptureInput): PendingLatencyPaint | null {
      if (pending !== null || !input.latency?.assistantMessageId) return null;
      pending = {
        conversationId: input.conversationId,
        requestId: input.latency.requestId,
        messageId: input.latency.assistantMessageId,
        backendFirstDeltaWrittenEpochMs: input.latency.backendFirstDeltaWrittenEpochMs,
        firstChunkReceivedPerfMs: input.firstChunkReceivedPerfMs,
        metrics: input.latency.metrics,
        serverQuality: input.latency.quality,
        measured: false,
      };
      return pending;
    },

    /**
     * Compute the sixth metric after React commit + double rAF.
     * One-shot per stream and a no-op in hidden tabs (browsers throttle rAF
     * there, which would skew the value).
     */
    measure(paintedPerfMs: number, timeOrigin: number, visible: boolean): PendingLatencyPaint | null {
      if (!pending || pending.measured || !visible) return pending;
      const computed = computeFrontendLatency(
        {
          paintedPerfMs,
          timeOrigin,
          backendFirstDeltaWrittenEpochMs: pending.backendFirstDeltaWrittenEpochMs,
          firstChunkReceivedPerfMs: pending.firstChunkReceivedPerfMs,
        },
        pending.serverQuality,
      );
      pending = { ...pending, measured: true, computed };
      return pending;
    },

    /**
     * Consume the report when stream completion arrives. Before the paint
     * measurement this defers (marks completion) so the double-rAF callback
     * can still submit it; after measurement it returns the idempotent
     * submission payload exactly once. A rejected cross-clock value is never
     * persisted as a number.
     */
    report(conversationId: string, messageId: string): ReportFrontendLatencyPayload | null {
      if (!pending || pending.messageId !== messageId) return null;
      if (!pending.measured) {
        pending = { ...pending, completeArrived: true };
        return null;
      }
      const computed = pending.computed;
      const requestId = pending.requestId;
      pending = null;
      if (
        computed === undefined ||
        computed.frontendRenderMs === undefined ||
        computed.frontendFirstChunkPaintedEpochMs === undefined
      ) {
        return null;
      }
      return {
        schemaVersion: 1,
        requestId,
        frontendFirstChunkPaintedEpochMs: computed.frontendFirstChunkPaintedEpochMs,
        frontendRenderMs: computed.frontendRenderMs,
        browserRenderOnlyMs: computed.browserRenderOnlyMs,
        quality: computed.quality,
      };
    },

    /** Attach the browser-computed sixth metric; never overwrites a present one. */
    mergeIntoMessage(message: Message): Message {
      if (!pending || pending.messageId !== message.id || pending.computed === undefined) return message;
      const base = message.latencyMetrics;
      if (base?.frontendRenderMs !== undefined) return message;
      return {
        ...message,
        latencyMetrics: base
          ? {
              ...base,
              frontendRenderMs: pending.computed.frontendRenderMs,
              browserRenderOnlyMs: pending.computed.browserRenderOnlyMs,
              quality: pending.computed.quality,
            }
          : mergeLatencyMetrics(pending.metrics, pending.computed),
      };
    },

    clear(): void {
      pending = null;
    },
  };
}
