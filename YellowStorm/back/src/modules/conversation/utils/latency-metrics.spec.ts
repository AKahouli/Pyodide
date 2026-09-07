import {
  buildStreamChunkLatencyData,
  computeServerLatencyMetrics,
  LatencyEnvelopeTracker,
  parseAdkLatencyTrace,
} from './latency-metrics';
import type { AdkLatencyTracePayload, ConversationLatencyStartContext } from '../interfaces/latency.interface';

const startContext: ConversationLatencyStartContext = {
  schemaVersion: 1,
  requestId: 'req-1',
  assistantMessageId: 'msg-1',
  backendReceivedEpochMs: 1000,
};

function tracePayload(overrides: Partial<AdkLatencyTracePayload> = {}): AdkLatencyTracePayload {
  return {
    schema_version: 1,
    request_id: 'req-1',
    assistant_message_id: 'msg-1',
    adk_request_received_epoch_ms: 1120,
    llm_request_start_epoch_ms: 1180,
    llm_first_delta_epoch_ms: 1680,
    adk_first_delta_forwarded_epoch_ms: 1690,
    adk_pre_provider_ms: 60,
    provider_ttft_ms: 500,
    adk_forwarding_ms: 10,
    ...overrides,
  };
}

describe('parseAdkLatencyTrace', () => {
  it('returns null for chunks without a latency trace', () => {
    expect(parseAdkLatencyTrace(undefined)).toBeNull();
    expect(parseAdkLatencyTrace({ action: 'add' })).toBeNull();
    expect(parseAdkLatencyTrace({ latency_trace: {} })).toBeNull();
  });

  it('parses a snake_case trace payload', () => {
    const parsed = parseAdkLatencyTrace({ latency_trace: tracePayload() });
    expect(parsed?.adk_request_received_epoch_ms).toBe(1120);
    expect(parsed?.provider_ttft_ms).toBe(500);
  });
});

describe('computeServerLatencyMetrics', () => {
  it('computes backend pre-ADK and backend forwarding, trusting ADK-local durations', () => {
    const { metrics, quality } = computeServerLatencyMetrics(startContext, tracePayload(), 1705);
    expect(metrics.backendPreAdkMs).toBe(120);
    expect(metrics.adkPreProviderMs).toBe(60);
    expect(metrics.providerTtftMs).toBe(500);
    expect(metrics.adkForwardingMs).toBe(10);
    expect(metrics.backendForwardingMs).toBe(15);
    expect(quality).toBe('ok');
  });

  it('rejects implausible cross-clock values as clock-skew', () => {
    const { metrics, quality } = computeServerLatencyMetrics(
      startContext,
      tracePayload({ adk_request_received_epoch_ms: 1000 - 400 }),
      1705,
    );
    expect(metrics.backendPreAdkMs).toBeUndefined();
    expect(quality).toBe('clock-skew');
  });

  it('clamps small negative clock jitter to zero while flagging skew', () => {
    const { metrics, quality } = computeServerLatencyMetrics(
      startContext,
      tracePayload({ adk_request_received_epoch_ms: 1000 - 3 }),
      1705,
    );
    expect(metrics.backendPreAdkMs).toBe(0);
    expect(quality).toBe('clock-skew');
  });

  it('marks quality partial when ADK-local stages are absent', () => {
    const { metrics, quality } = computeServerLatencyMetrics(
      startContext,
      tracePayload({ provider_ttft_ms: undefined, adk_forwarding_ms: undefined }),
      1705,
    );
    expect(metrics.providerTtftMs).toBeUndefined();
    expect(quality).toBe('partial');
  });

  it('rejects non-finite monotonic durations', () => {
    const { metrics } = computeServerLatencyMetrics(
      startContext,
      tracePayload({ adk_pre_provider_ms: Number.NaN }),
      1705,
    );
    expect(metrics.adkPreProviderMs).toBeUndefined();
  });

  it('carries a nested snake_case breakdown into the metrics', () => {
    const { metrics, quality } = computeServerLatencyMetrics(
      startContext,
      tracePayload({
        adk_pre_provider_breakdown: {
          protobuf_to_dict_ms: 14,
          request_logging_ms: 412,
          request_conversion_ms: 36,
          workflow_dispatch_ms: 8,
          session_lock_wait_ms: 0,
          orchestration_setup_ms: 31,
          agent_tool_preparation_ms: 814,
          session_runner_setup_ms: 207,
          adk_runtime_pre_model_ms: 848,
        },
      }),
      1705,
    );
    expect(metrics.adkPreProviderBreakdown).toEqual({
      protobufToDictMs: 14,
      requestLoggingMs: 412,
      requestConversionMs: 36,
      workflowDispatchMs: 8,
      sessionLockWaitMs: 0,
      orchestrationSetupMs: 31,
      agentToolPreparationMs: 814,
      sessionRunnerSetupMs: 207,
      adkRuntimePreModelMs: 848,
    });
    expect(quality).toBe('ok');
  });

  it('omits invalid breakdown children but keeps valid ones', () => {
    const { metrics } = computeServerLatencyMetrics(
      startContext,
      tracePayload({
        adk_pre_provider_breakdown: {
          protobuf_to_dict_ms: -5,
          request_logging_ms: 70_000,
          request_conversion_ms: 20,
        },
      }),
      1705,
    );
    expect(metrics.adkPreProviderBreakdown).toEqual({ requestConversionMs: 20 });
  });

  it('drops a breakdown with no surviving children', () => {
    const { metrics } = computeServerLatencyMetrics(
      startContext,
      tracePayload({ adk_pre_provider_breakdown: { protobuf_to_dict_ms: Number.NaN } }),
      1705,
    );
    expect(metrics.adkPreProviderBreakdown).toBeUndefined();
  });

  it('carries a nested session/runner breakdown under its parent child', () => {
    const { metrics, quality } = computeServerLatencyMetrics(
      startContext,
      tracePayload({
        adk_pre_provider_breakdown: {
          session_runner_setup_ms: 1380,
          session_runner_setup_breakdown: {
            session_service_init_ms: 5,
            session_lookup_ms: 120,
            session_create_seed_ms: 30,
            runner_construction_ms: 20,
            runner_handoff_ms: 4,
          },
        },
      }),
      1705,
    );
    expect(metrics.adkPreProviderBreakdown).toEqual({
      sessionRunnerSetupMs: 1380,
      sessionRunnerSetupBreakdown: {
        sessionServiceInitMs: 5,
        sessionLookupMs: 120,
        sessionCreateSeedMs: 30,
        runnerConstructionMs: 20,
        runnerHandoffMs: 4,
      },
    });
    expect(quality).toBe('ok');
  });

  it('sanitizes nested session/runner children independently and omits an empty nest', () => {
    const { metrics } = computeServerLatencyMetrics(
      startContext,
      tracePayload({
        adk_pre_provider_breakdown: {
          session_runner_setup_ms: 1380,
          session_runner_setup_breakdown: {
            session_service_init_ms: -1,
            session_lookup_ms: 61_000,
            runner_construction_ms: 12,
          },
        },
      }),
      1705,
    );
    expect(metrics.adkPreProviderBreakdown).toEqual({
      sessionRunnerSetupMs: 1380,
      sessionRunnerSetupBreakdown: { runnerConstructionMs: 12 },
    });
  });

  it('keeps quality ok for a historical trace without a breakdown', () => {
    const { metrics, quality } = computeServerLatencyMetrics(startContext, tracePayload(), 1705);
    expect(metrics.adkPreProviderBreakdown).toBeUndefined();
    expect(quality).toBe('ok');
  });

  it('does not let a missing breakdown downgrade quality and keeps it under clock-skew', () => {
    const { metrics, quality } = computeServerLatencyMetrics(
      startContext,
      tracePayload({ adk_request_received_epoch_ms: 1000 - 400 }),
      1705,
    );
    expect(quality).toBe('clock-skew');
    expect(metrics.adkPreProviderBreakdown).toBeUndefined();
  });
});

describe('buildStreamChunkLatencyData', () => {
  it('assembles the one-time SSE envelope', () => {
    const envelope = buildStreamChunkLatencyData(startContext, tracePayload(), 1705);
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.requestId).toBe('req-1');
    expect(envelope.assistantMessageId).toBe('msg-1');
    expect(envelope.backendFirstDeltaWrittenEpochMs).toBe(1705);
    expect(envelope.metrics.backendForwardingMs).toBe(15);
    expect(envelope.quality).toBe('ok');
  });
});

describe('LatencyEnvelopeTracker', () => {
  const gRpcChunk = { action: 'add', latency_trace: tracePayload() };

  it('attaches the envelope to exactly one broadcast', () => {
    let now = 1700;
    const tracker = new LatencyEnvelopeTracker(startContext, () => now);

    tracker.capture({ action: 'heartbeat' });
    expect(tracker.take()).toBeUndefined();

    tracker.capture(gRpcChunk);
    const first = tracker.take();
    expect(first?.backendFirstDeltaWrittenEpochMs).toBe(1700);
    expect(first?.metrics.backendPreAdkMs).toBe(120);

    now = 1900;
    tracker.capture(gRpcChunk);
    expect(tracker.take()).toBeUndefined();
  });

  it('does nothing without a latency start context', () => {
    const tracker = new LatencyEnvelopeTracker(undefined);
    tracker.capture(gRpcChunk);
    expect(tracker.take()).toBeUndefined();
  });

  it('ignores chunks without a trace before the traced chunk arrives', () => {
    const tracker = new LatencyEnvelopeTracker(startContext, () => 1);
    tracker.capture({ action: 'add' });
    expect(tracker.take()).toBeUndefined();
    tracker.capture(gRpcChunk);
    expect(tracker.take()).toBeDefined();
  });

  it('keeps a captured trace pending until a broadcast takes it', () => {
    // A trace can arrive on a chunk that is not broadcast (e.g. usage-only);
    // it must ride on the next broadcast, never be dropped.
    const tracker = new LatencyEnvelopeTracker(startContext, () => 1);
    tracker.capture(gRpcChunk);
    tracker.capture({ action: 'update' });
    expect(tracker.take()).toBeDefined();
  });
});
