import { describe, expect, it } from 'vitest';
import { createLatencyPaintController } from './store-latency';
import type { Message, StreamChunkLatencyData } from './types';

const envelope: StreamChunkLatencyData = {
  schemaVersion: 1,
  requestId: 'req-1',
  assistantMessageId: 'ai-1',
  backendFirstDeltaWrittenEpochMs: 5_000_000,
  metrics: {
    backendPreAdkMs: 120,
    adkPreProviderMs: 60,
    providerTtftMs: 500,
    adkForwardingMs: 10,
    backendForwardingMs: 15,
    quality: 'ok',
  },
  quality: 'ok',
};

function capture(controller: ReturnType<typeof createLatencyPaintController>, arrivalMs = 1000) {
  return controller.capture({
    conversationId: 'conv-1',
    firstChunkReceivedPerfMs: arrivalMs,
    latency: envelope,
  });
}

describe('latency paint controller', () => {
  it('captures the envelope once and ignores later envelopes', () => {
    const controller = createLatencyPaintController();
    expect(capture(controller)?.messageId).toBe('ai-1');
    expect(capture(controller)).toBeNull();
  });

  it('measures once, computing the sixth metric and attaching it to the message', () => {
    const controller = createLatencyPaintController();
    capture(controller);

    // Hidden tabs never measure.
    expect(controller.measure(1080, 5_000_000, false)?.measured).toBe(false);

    const pending = controller.measure(1080, 5_000_000, true);
    expect(pending?.computed).toMatchObject({
      // painted epoch (5_001_080) - backend write stamp (5_000_000).
      frontendRenderMs: 1080,
      frontendFirstChunkPaintedEpochMs: 5_001_080,
      // Browser-monotonic only: paint (1080) - chunk arrival (1000).
      browserRenderOnlyMs: 80,
      quality: 'ok',
    });
    expect(controller.measure(1200, 5_000_000, true)).toBe(pending);

    const message: Message = { id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai', isComplete: true, createdAt: new Date().toISOString() };
    const merged = controller.mergeIntoMessage(message);
    expect(merged.latencyMetrics).toMatchObject({
      schemaVersion: 1,
      backendPreAdkMs: 120,
      providerTtftMs: 500,
      frontendRenderMs: 1080,
      quality: 'ok',
    });
    // Merge is not destructive for messages without a pending stream.
    expect(controller.mergeIntoMessage({ ...message, id: 'other' })).toMatchObject({ id: 'other' });
  });

  it('reports exactly once after measurement and never for rejected values', () => {
    const controller = createLatencyPaintController();
    capture(controller);
    controller.measure(1080, 5_000_000, true);

    const payload = controller.report('conv-1', 'ai-1');
    expect(payload).toEqual({
      schemaVersion: 1,
      requestId: 'req-1',
      frontendFirstChunkPaintedEpochMs: 5_001_080,
      frontendRenderMs: 1080,
      browserRenderOnlyMs: 80,
      quality: 'ok',
    });
    expect(controller.report('conv-1', 'ai-1')).toBeNull();
    expect(controller.pending).toBeNull();
  });

  it('defers the report when completion arrives before paint', () => {
    const controller = createLatencyPaintController();
    capture(controller);

    expect(controller.report('conv-1', 'ai-1')).toBeNull();
    expect(controller.pending?.completeArrived).toBe(true);

    controller.measure(1080, 5_000_000, true);
    const payload = controller.report('conv-1', 'ai-1');
    expect(payload?.frontendRenderMs).toBe(1080);
  });

  it('submits nothing when the cross-clock value was rejected as skew', () => {
    const controller = createLatencyPaintController();
    capture(controller);
    // backend stamp far in the future relative to the paint → clock-skew.
    controller.measure(1080, 5_000_000, true);
    // Rebuild a skew scenario: stamp 120s ahead of the paint epoch.
    const skewController = createLatencyPaintController();
    skewController.capture({
      conversationId: 'conv-1',
      firstChunkReceivedPerfMs: 1000,
      latency: { ...envelope, backendFirstDeltaWrittenEpochMs: 5_000_000 + 120_000 },
    });
    skewController.measure(1080, 5_000_000, true);
    const pending = skewController.pending;
    expect(pending?.computed?.frontendRenderMs).toBeUndefined();
    expect(skewController.report('conv-1', 'ai-1')).toBeNull();
    void pending;
  });

  it('does not overwrite an existing frontend value on the message', () => {
    const controller = createLatencyPaintController();
    capture(controller);
    controller.measure(1080, 5_000_000, true);
    const message: Message = {
      id: 'ai-1',
      conversationId: 'conv-1',
      conversationType: 'ai',
      isComplete: true,
      createdAt: new Date().toISOString(),
      latencyMetrics: { schemaVersion: 1, frontendRenderMs: 42, quality: 'ok' },
    };
    expect(controller.mergeIntoMessage(message).latencyMetrics?.frontendRenderMs).toBe(42);
  });
});
