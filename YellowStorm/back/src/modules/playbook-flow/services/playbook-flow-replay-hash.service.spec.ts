import { PlaybookFlowReplayHashService } from './playbook-flow-replay-hash.service';

describe('PlaybookFlowReplayHashService', () => {
  let service: PlaybookFlowReplayHashService;

  beforeEach(() => {
    service = new PlaybookFlowReplayHashService();
  });

  it('builds the same hash for reordered object keys', () => {
    const left = service.buildHash({ b: 2, a: 1, nested: { y: true, x: false } });
    const right = service.buildHash({ nested: { x: false, y: true }, a: 1, b: 2 });

    expect(left).toBe(right);
  });

  it('ignores volatile fields when hashing', () => {
    const first = service.buildHash({ a: 1, updatedAt: '2026-01-01T00:00:00Z', usage: { totalTokens: 2 } });
    const second = service.buildHash({ a: 1, updatedAt: '2026-01-02T00:00:00Z', usage: { totalTokens: 999 } });

    expect(first).toBe(second);
  });

  it('ignores step replay mode when hashing replay fingerprints', () => {
    const first = service.buildHash({
      id: 'step-1',
      metadata: {
        description: 'Analyze France GDP',
        stepReplayMode: 'live',
      },
    });
    const second = service.buildHash({
      id: 'step-1',
      metadata: {
        description: 'Analyze France GDP',
        stepReplayMode: 'replay_flex',
      },
    });

    expect(first).toBe(second);
  });

  it('returns null fingerprint for empty values', () => {
    const fingerprints = service.buildReplayFingerprints({
      inputContext: undefined,
      flowSnapshot: null,
      nodeSnapshot: {},
      agentConfig: null,
      modelConfig: {},
      toolConfig: {},
      outputContract: null,
    });

    expect(fingerprints).toEqual({
      inputContextHash: null,
      flowSnapshotHash: null,
      nodeSnapshotHash: null,
      agentConfigHash: null,
      modelConfigHash: null,
      toolConfigHash: null,
      outputContractHash: null,
    });
  });
});
