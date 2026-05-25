import { PlaybookFlowReplayEligibilityService } from './playbook-flow-replay-eligibility.service';
import type { ResolvedReplayArtifacts } from '../interfaces/playbook-flow-replay-artifact.interface';

function makeArtifacts(overrides: Partial<ResolvedReplayArtifacts> = {}): ResolvedReplayArtifacts {
  return {
    taskId: 'task-1',
    replayId: 'replay-1',
    validationVersion: 1,
    mode: 'replay_strict',
    referenceOutput: null,
    outputFormatGuide: null,
    toolCalls: [],
    reasoningChain: [],
    fingerprints: {
      inputContextHash: 'input-a',
      flowSnapshotHash: 'flow-a',
      nodeSnapshotHash: 'node-a',
      agentConfigHash: null,
      modelConfigHash: 'model-a',
      toolConfigHash: 'tool-a',
      outputContractHash: 'contract-a',
    },
    behaviorBaseline: null,
    toolPolicy: null,
    outputContract: null,
    replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
    ...overrides,
  };
}

describe('PlaybookFlowReplayEligibilityService', () => {
  let service: PlaybookFlowReplayEligibilityService;

  beforeEach(() => {
    service = new PlaybookFlowReplayEligibilityService();
  });

  it('applies strict replay when core fingerprints match', () => {
    const result = service.evaluateReplayEligibility({
      mode: 'replay_strict',
      artifacts: makeArtifacts(),
      currentFingerprints: {
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-a',
        nodeSnapshotHash: 'node-a',
        agentConfigHash: null,
        modelConfigHash: 'model-a',
        toolConfigHash: 'tool-a',
        outputContractHash: 'contract-a',
      },
    });

    expect(result.applied).toBe(true);
    expect(result.confidenceScore).toBe(100);
  });

  it('skips strict replay when node hash changed', () => {
    const result = service.evaluateReplayEligibility({
      mode: 'replay_strict',
      artifacts: makeArtifacts(),
      currentFingerprints: {
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-a',
        nodeSnapshotHash: 'node-b',
        agentConfigHash: null,
        modelConfigHash: 'model-a',
        toolConfigHash: 'tool-a',
        outputContractHash: 'contract-a',
      },
    });

    expect(result.applied).toBe(false);
    expect(result.invalidationReasons).toContain('node_snapshot_mismatch');
  });

  it('applies adaptive replay with warning when only node hash drifts', () => {
    const result = service.evaluateReplayEligibility({
      mode: 'replay_adaptive',
      artifacts: makeArtifacts({ mode: 'replay_adaptive' }),
      currentFingerprints: {
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-a',
        nodeSnapshotHash: 'node-b',
        agentConfigHash: null,
        modelConfigHash: 'model-a',
        toolConfigHash: 'tool-a',
        outputContractHash: 'contract-a',
      },
    });

    expect(result.applied).toBe(true);
    expect(result.invalidationReasons).toContain('node_snapshot_mismatch');
  });

  it('skips flex replay when output contract mismatches', () => {
    const result = service.evaluateReplayEligibility({
      mode: 'replay_flex',
      artifacts: makeArtifacts({ mode: 'replay_flex' }),
      currentFingerprints: {
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-a',
        nodeSnapshotHash: 'node-a',
        agentConfigHash: null,
        modelConfigHash: 'model-a',
        toolConfigHash: 'tool-a',
        outputContractHash: 'contract-b',
      },
    });

    expect(result.applied).toBe(false);
    expect(result.invalidationReasons).toContain('output_contract_mismatch');
  });
});
