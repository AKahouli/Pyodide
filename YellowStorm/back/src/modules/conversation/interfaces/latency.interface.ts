/**
 * End-to-end latency instrumentation contracts for the classic Conversation flow.
 *
 * The six primary metrics describe one assistant generation across three
 * processes (browser, Nest backend, Python ADK). Cross-process durations are
 * computed from epoch-millisecond timestamps and therefore depend on host clock
 * synchronization; same-process durations are measured with monotonic clocks
 * inside ADK and are trusted as-is.
 */

export type ConversationLatencyQuality = 'ok' | 'partial' | 'clock-skew';

/** ADK-local monotonic breakdown of `adkPreProviderMs`. Diagnostic only. */
export interface AdkPreProviderBreakdownV1 {
  protobufToDictMs?: number;
  requestLoggingMs?: number;
  requestConversionMs?: number;
  workflowDispatchMs?: number;
  sessionLockWaitMs?: number;
  orchestrationSetupMs?: number;
  agentToolPreparationMs?: number;
  sessionRunnerSetupMs?: number;
  adkRuntimePreModelMs?: number;
}

export interface ConversationLatencyMetricsV1 {
  schemaVersion: 1;
  /** adk.request_received - backend.received (cross-clock). */
  backendPreAdkMs?: number;
  /** llm.request_start - adk.request_received (monotonic, ADK-local). */
  adkPreProviderMs?: number;
  /** Diagnostic children of adkPreProviderMs; absent on historical messages. */
  adkPreProviderBreakdown?: AdkPreProviderBreakdownV1;
  /** llm.first_delta - llm.request_start (monotonic, ADK-local). */
  providerTtftMs?: number;
  /** adk.first_delta_forwarded - llm.first_delta (monotonic, ADK-local). */
  adkForwardingMs?: number;
  /** backend.first_delta_written - adk.first_delta_forwarded (cross-clock). */
  backendForwardingMs?: number;
  /** frontend.first_chunk_painted - backend.first_delta_written (cross-clock). */
  frontendRenderMs?: number;
  /** Diagnostic only: paint minus SSE arrival, browser-monotonic. Not a primary UI row. */
  browserRenderOnlyMs?: number;
  quality?: ConversationLatencyQuality;
}

/** Backend-side context captured at controller entry and carried into the gRPC request. */
export interface ConversationLatencyStartContext {
  schemaVersion: 1;
  /** Absent when neither the client nor the request context supplied an ID. */
  requestId?: string;
  assistantMessageId?: string;
  backendReceivedEpochMs: number;
  backendReceivedMonoNs?: bigint;
}

/** Shape of the `LatencyTrace` protobuf message as parsed by proto-loader (snake_case keys). */
export interface AdkLatencyTracePayload {
  schema_version?: number;
  request_id?: string;
  assistant_message_id?: string;
  adk_request_received_epoch_ms?: number;
  llm_request_start_epoch_ms?: number;
  llm_first_delta_epoch_ms?: number;
  adk_first_delta_forwarded_epoch_ms?: number;
  adk_pre_provider_ms?: number;
  adk_pre_provider_breakdown?: {
    protobuf_to_dict_ms?: number;
    request_logging_ms?: number;
    request_conversion_ms?: number;
    workflow_dispatch_ms?: number;
    session_lock_wait_ms?: number;
    orchestration_setup_ms?: number;
    agent_tool_preparation_ms?: number;
    session_runner_setup_ms?: number;
    adk_runtime_pre_model_ms?: number;
  };
  provider_ttft_ms?: number;
  adk_forwarding_ms?: number;
}

/** One-time latency envelope attached to the first model-derived SSE stream_chunk. */
export interface StreamChunkLatencyData {
  schemaVersion: 1;
  requestId: string;
  assistantMessageId: string;
  backendFirstDeltaWrittenEpochMs: number;
  metrics: Omit<
    ConversationLatencyMetricsV1,
    'schemaVersion' | 'frontendRenderMs' | 'browserRenderOnlyMs'
  >;
  quality: ConversationLatencyQuality;
}

/** Payload accepted by the idempotent frontend-paint reporting endpoint. */
export interface FrontendLatencyPatch {
  frontendFirstChunkPaintedEpochMs: number;
  frontendRenderMs: number;
  browserRenderOnlyMs?: number;
  quality: ConversationLatencyQuality;
}

/** Upper bound for a plausible single-stage duration in milliseconds. */
export const MAX_PLAUSIBLE_STAGE_MS = 60_000;
/** Small negative drift (clock jitter) clamped to 0 instead of being discarded. */
const CLOCK_JITTER_TOLERANCE_MS = -5;

export function isFiniteMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validate a cross-clock duration before display/persistence.
 * Returns an undefined value when the number must not be shown.
 */
export function validateCrossClockDurationMs(valueMs: number): {
  value?: number;
  quality: ConversationLatencyQuality;
} {
  if (!Number.isFinite(valueMs)) return { quality: 'clock-skew' };
  if (valueMs < CLOCK_JITTER_TOLERANCE_MS || valueMs > MAX_PLAUSIBLE_STAGE_MS) {
    return { quality: 'clock-skew' };
  }
  if (valueMs < 0) return { value: 0, quality: 'clock-skew' };
  return { value: valueMs, quality: 'ok' };
}

/** Validate an ADK-local (monotonic) duration reported in the trace envelope. */
export function sanitizeMonotonicDurationMs(valueMs: unknown): number | undefined {
  if (!isFiniteMs(valueMs)) return undefined;
  if (valueMs < 0 || valueMs > MAX_PLAUSIBLE_STAGE_MS) return undefined;
  return valueMs;
}
