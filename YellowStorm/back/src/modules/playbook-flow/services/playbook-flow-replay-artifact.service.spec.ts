import { Types } from 'mongoose';
import { PlaybookFlowReplayArtifactService } from './playbook-flow-replay-artifact.service';
import type { FlowValidatedReplayDocument } from '../schemas/playbook-flow-validated-replay.schema';
import { PlaybookFlowReplayHashService } from './playbook-flow-replay-hash.service';

function makeReplay(overrides: Partial<FlowValidatedReplayDocument> = {}): any {
  return {
    taskId: overrides.taskId ?? 'task-1',
    _id: overrides._id ?? 'replay-1',
    validationVersion: overrides.validationVersion ?? 1,
    mode: overrides.mode ?? 'strict_replay',
    referenceOutput: overrides.referenceOutput ?? 'baseline output',
    outputFormatGuide: overrides.outputFormatGuide ?? null,
    intentKey: (overrides as any).intentKey ?? null,
    intentLabel: (overrides as any).intentLabel ?? null,
    reasoningOutline: (overrides as any).reasoningOutline ?? [],
    stableReasoningRules: (overrides as any).stableReasoningRules ?? [],
    contextVariableSchema: (overrides as any).contextVariableSchema ?? [],
    toolTraceTemplate: (overrides as any).toolTraceTemplate ?? [],
    driftPolicy: (overrides as any).driftPolicy ?? null,
    toolCalls: overrides.toolCalls ?? [],
    reasoningChain: overrides.reasoningChain ?? [],
    fingerprints: overrides.fingerprints ?? null,
    behaviorBaseline: overrides.behaviorBaseline ?? null,
    toolPolicy: overrides.toolPolicy ?? null,
    outputContract: overrides.outputContract ?? null,
    referenceNodeSnapshot: overrides.referenceNodeSnapshot ?? null,
    replayConfig: overrides.replayConfig ?? { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
  };
}

describe('PlaybookFlowReplayArtifactService', () => {
  let service: PlaybookFlowReplayArtifactService;
  let replayModel: { find: jest.Mock; findOne: jest.Mock };

  beforeEach(() => {
    replayModel = {
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }),
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) }),
    };
    service = new PlaybookFlowReplayArtifactService(
      replayModel as any,
      { setContext: jest.fn() } as any,
      new PlaybookFlowReplayHashService(),
    );
  });

  it('returns empty map when no task IDs provided', async () => {
    const result = await service.resolveReplayArtifacts('flow-1', []);
    expect(result.size).toBe(0);
    expect(replayModel.find).not.toHaveBeenCalled();
  });

  it('returns empty map when no active replays exist', async () => {
    const result = await service.resolveReplayArtifacts('flow-1', ['task-1', 'task-2']);
    expect(result.size).toBe(0);
    expect(replayModel.find).toHaveBeenCalledWith({
      flowId: 'flow-1',
      taskId: { $in: ['task-1', 'task-2'] },
      status: 'active',
    });
  });

  it('maps active replays to resolved artifacts keyed by taskId', async () => {
    const replay = makeReplay({
      taskId: 'task-1',
      referenceOutput: 'ref output',
      outputFormatGuide: 'format guide',
      toolCalls: [{ callIndex: 1, toolName: 'search', args: {}, outputSummary: 'hits' }],
      reasoningChain: [{ id: 'r1', type: 'analysis', label: 'Assess', description: 'Assessed risk.' }],
      replayConfig: { replayOutputFormat: true, replayToolTrace: false, replayReasoningChain: true },
    });
    replayModel.find.mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([replay]) }) });

    const result = await service.resolveReplayArtifacts('flow-1', ['task-1']);

    expect(result.size).toBe(1);
    const artifacts = result.get('task-1')!;
    expect(artifacts.taskId).toBe('task-1');
    expect(artifacts.replayId).toBe('replay-1');
    expect(artifacts.mode).toBe('replay_strict');
    expect(artifacts.referenceOutput).toBe('ref output');
    expect(artifacts.outputFormatGuide).toBe('format guide');
    expect(artifacts.intentKey).toBeNull();
    expect(artifacts.toolCalls).toHaveLength(1);
    expect(artifacts.reasoningChain).toHaveLength(1);
    expect(artifacts.replayConfig.replayOutputFormat).toBe(true);
    expect(artifacts.replayConfig.replayReasoningChain).toBe(true);
    expect(artifacts.replayConfig.replayToolTrace).toBe(false);
  });

  it('maps new structured replay metadata', async () => {
    const replay = makeReplay({
      mode: 'replay_flex' as any,
      intentKey: 'facts.verify',
      intentLabel: 'Verify facts',
      reasoningOutline: [{ stageKey: 'verify', stageType: 'analysis', label: 'Verify', description: 'Verify facts' }] as any,
      stableReasoningRules: ['Do not skip evidence checks'] as any,
      contextVariableSchema: [{ key: 'ticker', label: 'Ticker', source: 'input_context', valueType: 'string', required: true }] as any,
      toolTraceTemplate: [{ stepIndex: 1, toolName: 'search', purpose: 'Find evidence', argumentShape: { ticker: 'string' }, required: true }] as any,
      driftPolicy: { requireSameIntent: true, requireSameReasoningStages: true, requireSameToolOrder: true, allowAdditionalTools: false, allowArgumentValueChanges: true, enforceOutputContract: true } as any,
      fingerprints: { inputContextHash: 'abc', nodeSnapshotHash: 'legacy-node-hash' } as any,
      behaviorBaseline: { decisionInvariants: ['Verify facts'], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' } as any,
      toolPolicy: { requiredTools: ['search'], forbiddenTools: [], sequencingRules: [], requireSameOrder: false } as any,
      outputContract: { type: 'freeform', requiredSections: [], forbiddenSections: [], jsonSchema: null, citationPolicy: 'optional' } as any,
      referenceNodeSnapshot: {
        id: 'step-1',
        metadata: {
          description: 'Verify facts',
          stepReplayMode: 'live',
        },
      } as any,
    });
    replayModel.find.mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([replay]) }) });

    const result = await service.resolveReplayArtifacts('flow-1', ['task-1']);
    const artifacts = result.get('task-1')!;

    expect(artifacts.mode).toBe('replay_flex');
    expect(artifacts.intentKey).toBe('facts.verify');
    expect(artifacts.intentLabel).toBe('Verify facts');
    expect(artifacts.reasoningOutline).toHaveLength(1);
    expect(artifacts.stableReasoningRules).toEqual(['Do not skip evidence checks']);
    expect(artifacts.contextVariableSchema).toHaveLength(1);
    expect(artifacts.toolTraceTemplate).toHaveLength(1);
    expect(artifacts.driftPolicy?.enforceOutputContract).toBe(true);
    expect(artifacts.fingerprints?.inputContextHash).toBe('abc');
    expect(artifacts.fingerprints?.nodeSnapshotHash).toBe('legacy-node-hash');
    expect(artifacts.behaviorBaseline?.decisionInvariants).toEqual(['Verify facts']);
    expect(artifacts.toolPolicy?.requiredTools).toEqual(['search']);
    expect(artifacts.outputContract?.type).toBe('freeform');
  });

  it('defaults missing replayConfig fields to schema-consistent values', async () => {
    const replay = makeReplay({ replayConfig: undefined as any });
    replayModel.find.mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([replay]) }) });

    const result = await service.resolveReplayArtifacts('flow-1', ['task-1']);
    const artifacts = result.get('task-1')!;
    expect(artifacts.replayConfig).toEqual({
      replayOutputFormat: false,
      replayToolTrace: false,
      replayReasoningChain: true,
    });
  });

  it('handles multiple tasks with mixed replay presence', async () => {
    const replay = makeReplay({ taskId: 'task-1' });
    replayModel.find.mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([replay]) }) });

    const result = await service.resolveReplayArtifacts('flow-1', ['task-1', 'task-2']);
    expect(result.has('task-1')).toBe(true);
    expect(result.has('task-2')).toBe(false);
  });

  it('resolves a persisted replay artifact by replay identity even when it is no longer active', async () => {
    const replayId = new Types.ObjectId();
    const replay = makeReplay({
      _id: replayId,
      taskId: 'task-1',
      validationVersion: 4,
    });
    replayModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(replay) }),
    });

    const result = await service.resolveReplayArtifactByIdentity({
      flowId: 'flow-1',
      taskId: 'task-1',
      replayId: replayId.toString(),
      validationVersion: 4,
    });

    expect(replayModel.findOne).toHaveBeenCalledWith({
      _id: replayId.toString(),
      flowId: 'flow-1',
      taskId: 'task-1',
      validationVersion: 4,
    });
    expect(result).toEqual(expect.objectContaining({
      taskId: 'task-1',
      replayId: replayId.toString(),
      validationVersion: 4,
    }));
  });
});
