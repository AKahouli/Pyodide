import { BackendPreAdkTracker } from './backend-latency-tracker';

/** Pin `process.hrtime.bigint()` to a deterministic sequence of ns values. */
function mockHrtimeSequence(sequenceNs: bigint[]): { restore: () => void } {
  let index = 0;
  const spy = jest
    .spyOn(process.hrtime, 'bigint')
    .mockImplementation(() => sequenceNs[Math.min(index++, sequenceNs.length - 1)]);
  return { restore: () => { spy.mockRestore(); } };
}

describe('BackendPreAdkTracker', () => {
  it('computes monotonic stage durations from begin/end pairs', () => {
    const { restore } = mockHrtimeSequence([
      1_000_000_000n,   // tracker start
      1_100_000_000n,   // begin controllerValidationRouting
      2_100_000_000n,   // end controllerValidationRouting
      2_200_000_000n,   // begin userMessagePersistence
      2_500_000_000n,   // end userMessagePersistence
    ]);
    try {
      const tracker = new BackendPreAdkTracker();
      tracker.begin('controllerValidationRoutingMs');
      tracker.end('controllerValidationRoutingMs');
      tracker.begin('userMessagePersistenceMs');
      tracker.end('userMessagePersistenceMs');
      expect(tracker.toBreakdown()).toEqual({
        controllerValidationRoutingMs: 1000,
        userMessagePersistenceMs: 300,
      });
    } finally {
      restore();
    }
  });

  it('is first-write-wins on both boundaries', () => {
    const { restore } = mockHrtimeSequence([
      0n,
      100n, 200n, 999n, 999n, // begin/end then repeated writes that must be ignored
    ]);
    try {
      const tracker = new BackendPreAdkTracker();
      tracker.begin('streamBootstrapMs');
      tracker.end('streamBootstrapMs');
      tracker.begin('streamBootstrapMs');
      tracker.end('streamBootstrapMs');
      expect(tracker.toBreakdown()).toEqual({ streamBootstrapMs: 0.0001 });
    } finally {
      restore();
    }
  });

  it('omits stages missing a boundary instead of zeroing them', () => {
    const { restore } = mockHrtimeSequence([0n, 100n, 200n]);
    try {
      const tracker = new BackendPreAdkTracker();
      tracker.begin('conversationContextLoadMs');
      tracker.end('conversationContextLoadMs');
      tracker.end('supplementalContextAssemblyMs'); // no begin
      expect(tracker.toBreakdown()).toEqual({ conversationContextLoadMs: 0.0001 });
    } finally {
      restore();
    }
  });

  it('drops implausible monotonic durations beyond the plausible bound', () => {
    const { restore } = mockHrtimeSequence([
      0n,
      0n,
      61_000_000_000n, // 61 s later — beyond MAX_PLAUSIBLE_STAGE_MS
    ]);
    try {
      const tracker = new BackendPreAdkTracker();
      tracker.begin('grpcPayloadPreparationMs');
      tracker.end('grpcPayloadPreparationMs');
      expect(tracker.toBreakdown()).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('adds a policy-validated grpcTransitToAdkMs without touching quality', () => {
    const { restore } = mockHrtimeSequence([0n, 0n, 1_000_000n]);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(50_000);
    try {
      const tracker = new BackendPreAdkTracker();
      tracker.begin('controllerValidationRoutingMs');
      tracker.end('controllerValidationRoutingMs');
      tracker.markGrpcDispatched();

      expect(tracker.toBreakdown({ adk_request_received_epoch_ms: 50_000 })).toEqual({
        controllerValidationRoutingMs: 1,
        grpcTransitToAdkMs: 0,
      });
      // Negative transit (dispatch after ADK receipt) is dropped, not clamped into the breakdown.
      expect(tracker.toBreakdown({ adk_request_received_epoch_ms: 49_000 })).toEqual({
        controllerValidationRoutingMs: 1,
      });
    } finally {
      clock.mockRestore();
      restore();
    }
  });

  it('omits grpcTransitToAdkMs when dispatch was never stamped', () => {
    const { restore } = mockHrtimeSequence([0n]);
    try {
      const tracker = new BackendPreAdkTracker();
      expect(tracker.toBreakdown({ adk_request_received_epoch_ms: 1_000 })).toBeUndefined();
      expect(tracker.toBreakdown()).toBeUndefined();
    } finally {
      restore();
    }
  });
});
