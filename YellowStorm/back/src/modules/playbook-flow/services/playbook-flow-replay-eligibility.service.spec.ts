import { PlaybookFlowReplayEligibilityService } from './playbook-flow-replay-eligibility.service';
import type { ResolvedReplayArtifacts } from '../interfaces/playbook-flow-replay-artifact.interface';

function makeArtifacts(overrides: Partial<ResolvedReplayArtifacts> = {}): ResolvedReplayArtifacts {
  return {
    taskId: 'task-1',
    replayId: 'replay-1',
    referenceExecutionId: 'reference-exec-1',
    validationVersion: 1,
    mode: 'replay_strict',
    isStale: false,
    staleReasons: [],
    referenceOutput: null,
    outputFormatGuide: null,
    intentKey: null,
    intentLabel: null,
    reasoningOutline: [],
    stableReasoningRules: [],
    contextVariableSchema: [],
    toolTraceTemplate: [],
    semanticChecklist: [],
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
    driftPolicy: null,
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

  it('uses configurable eligibilityThreshold when provided', () => {
    const result = service.evaluateReplayEligibility({
      mode: 'replay_flex',
      artifacts: makeArtifacts({ mode: 'replay_flex', fingerprints: { ...makeArtifacts().fingerprints!, modelConfigHash: 'different' } }),
      currentFingerprints: {
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-a',
        nodeSnapshotHash: 'node-a',
        agentConfigHash: null,
        modelConfigHash: 'model-a',
        toolConfigHash: 'tool-a',
        outputContractHash: 'contract-a',
      },
      eligibilityThreshold: 100,
    });

    expect(result.applied).toBe(false);
    expect(result.invalidationReasons).toContain('confidence_below_threshold');
  });

  it('applies when score meets configurable threshold', () => {
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
      eligibilityThreshold: 50,
    });

    expect(result.applied).toBe(true);
    expect(result.confidenceScore).toBe(100);
  });

  it('blocks strict replay when HITL context fingerprint drifts', () => {
    const result = service.evaluateReplayEligibility({
      mode: 'replay_strict',
      artifacts: makeArtifacts({
        hitlMemorySnapshots: [{
          interruptId: 'interrupt-1',
          nodeId: 'task-1',
          iteration: 0,
          type: 'clarification',
          blockerKind: null,
          reasonCode: 'missing_document',
          prompt: 'Which contract?',
          responseAction: 'reply',
          responseMessage: 'Use the signed contract.',
          responseScope: 'downstream_run',
          downstreamNodeIds: [],
          reusableInReplay: true,
          contextFingerprint: 'baseline-hitl',
        }],
      }),
      currentFingerprints: {
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-a',
        nodeSnapshotHash: 'node-a',
        agentConfigHash: null,
        modelConfigHash: 'model-a',
        toolConfigHash: 'tool-a',
        outputContractHash: 'contract-a',
      },
      currentHitlContextFingerprints: { 'interrupt-1': 'current-hitl' },
    });

    expect(result.applied).toBe(false);
    expect(result.invalidationReasons).toContain('hitl_context_drift');
  });

  it('blocks strict replay for baseline approvals that are not reusable', () => {
    const result = service.evaluateReplayEligibility({
      mode: 'replay_strict',
      artifacts: makeArtifacts({
        hitlMemorySnapshots: [{
          interruptId: 'approval-1',
          nodeId: 'task-1',
          iteration: 0,
          type: 'approval_request',
          blockerKind: null,
          reasonCode: 'external_send',
          prompt: 'Send email?',
          responseAction: 'approve',
          responseMessage: 'Approved.',
          responseScope: 'step_only',
          downstreamNodeIds: [],
          reusableInReplay: false,
          contextFingerprint: 'approval-hitl',
        }],
      }),
      currentFingerprints: {
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-a',
        nodeSnapshotHash: 'node-a',
        agentConfigHash: null,
        modelConfigHash: 'model-a',
        toolConfigHash: 'tool-a',
        outputContractHash: 'contract-a',
      },
      currentHitlContextFingerprints: { 'approval-1': 'approval-hitl' },
    });

    expect(result.applied).toBe(false);
    expect(result.invalidationReasons).toContain('hitl_approval_requires_confirmation');
  });
});
