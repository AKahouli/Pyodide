import { newObjectId } from '@common/postgres';
import { PlaybookFlowReplayArtifactService } from './playbook-flow-replay-artifact.service';
import type { FlowValidatedReplayRecord } from '../persistence/validated-replay.repository';
import { PlaybookFlowReplayHashService } from './playbook-flow-replay-hash.service';

function makeReplay(overrides: Record<string, unknown> = {}): FlowValidatedReplayRecord {
  return {
    taskId: 'task-1',
    id: 'replay-1',
    flowId: 'flow-1',
    referenceExecutionId: 'exec-1',
    validationVersion: 1,
    mode: 'strict_replay',
    isStale: false,
    staleReasons: [],
    referenceOutput: 'baseline output',
    outputFormatGuide: null,
    intentKey: null,
    intentLabel: null,
    reasoningOutline: [],
    stableReasoningRules: [],
    contextVariableSchema: [],
    toolTraceTemplate: [],
    driftPolicy: null,
    toolCalls: [],
    reasoningChain: [],
    fingerprints: null,
    behaviorBaseline: null,
    toolPolicy: null,
    outputContract: null,
    referenceNodeSnapshot: null,
    hitlMemorySnapshots: [],
    replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
    ...overrides,
  } as unknown as FlowValidatedReplayRecord;
}

describe('PlaybookFlowReplayArtifactService', () => {
  let service: PlaybookFlowReplayArtifactService;
  let replayRepository: { listActiveForTasks: jest.Mock; findByIdentity: jest.Mock; findActive: jest.Mock };

  beforeEach(() => {
    replayRepository = {
      listActiveForTasks: jest.fn().mockResolvedValue([]),
      findByIdentity: jest.fn().mockResolvedValue(null),
      findActive: jest.fn().mockResolvedValue(null),
    };
    service = new PlaybookFlowReplayArtifactService(
      replayRepository as any,
      { setContext: jest.fn() } as any,
      new PlaybookFlowReplayHashService(),
    );
  });

  it('returns empty map when no task IDs provided', async () => {
    const result = await service.resolveReplayArtifacts('flow-1', []);
    expect(result.size).toBe(0);
    expect(replayRepository.listActiveForTasks).not.toHaveBeenCalled();
  });

  it('returns empty map when no active replays exist', async () => {
    const result = await service.resolveReplayArtifacts('flow-1', ['task-1', 'task-2']);
    expect(result.size).toBe(0);
    expect(replayRepository.listActiveForTasks).toHaveBeenCalledWith('flow-1', ['task-1', 'task-2']);
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
    replayRepository.listActiveForTasks.mockResolvedValue([replay]);

    const result = await service.resolveReplayArtifacts('flow-1', ['task-1']);

    expect(result.size).toBe(1);
    const artifacts = result.get('task-1')!;
    expect(artifacts.taskId).toBe('task-1');
    expect(artifacts.replayId).toBe('replay-1');
    expect(artifacts.flowId).toBe('flow-1');
    expect(artifacts.referenceExecutionId).toBe('exec-1');
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
      mode: 'replay_flex',
      intentKey: 'facts.verify',
      intentLabel: 'Verify facts',
      reasoningOutline: [{ stageKey: 'verify', stageType: 'analysis', label: 'Verify', description: 'Verify facts' }],
      stableReasoningRules: ['Do not skip evidence checks'],
      contextVariableSchema: [{ key: 'ticker', label: 'Ticker', source: 'input_context', valueType: 'string', required: true }],
      toolTraceTemplate: [{ stepIndex: 1, toolName: 'search', purpose: 'Find evidence', argumentShape: { ticker: 'string' }, required: true }],
      driftPolicy: { requireSameIntent: true, requireSameReasoningStages: true, requireSameToolOrder: true, allowAdditionalTools: false, allowArgumentValueChanges: true, enforceOutputContract: true },
      fingerprints: { inputContextHash: 'abc', nodeSnapshotHash: 'legacy-node-hash' },
      behaviorBaseline: { decisionInvariants: ['Verify facts'], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' },
      toolPolicy: { requiredTools: ['search'], forbiddenTools: [], sequencingRules: [], requireSameOrder: false },
      outputContract: { type: 'freeform', requiredSections: [], forbiddenSections: [], jsonSchema: null, citationPolicy: 'optional' },
      referenceNodeSnapshot: {
        id: 'step-1',
        metadata: {
          description: 'Verify facts',
          stepReplayMode: 'live',
        },
      },
    });
    replayRepository.listActiveForTasks.mockResolvedValue([replay]);

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

  it('falls back like a lean read for fields a legacy baseline never stored', async () => {
    const legacy = {
      id: 'replay-legacy',
      flowId: 'flow-1',
      taskId: 'task-1',
      referenceExecutionId: 'exec-0',
      validationVersion: 1,
      mode: 'strict_replay',
      isStale: false,
      referenceOutput: 'old output',
      toolCalls: [],
    } as unknown as FlowValidatedReplayRecord;
    replayRepository.listActiveForTasks.mockResolvedValue([legacy]);

    const artifacts = (await service.resolveReplayArtifacts('flow-1', ['task-1'])).get('task-1')!;

    expect(artifacts).toMatchObject({
      mode: 'replay_strict',
      staleReasons: [],
      intentKey: null,
      intentLabel: null,
      reasoningOutline: [],
      semanticChecklist: [],
      hitlMemorySnapshots: [],
      driftPolicy: null,
      reasoningChain: [],
      fingerprints: null,
      outputContract: null,
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
    });
  });

  it('defaults missing replayConfig fields to schema-consistent values', async () => {
    const replay = makeReplay({ replayConfig: undefined });
    replayRepository.listActiveForTasks.mockResolvedValue([replay]);

    const result = await service.resolveReplayArtifacts('flow-1', ['task-1']);
    const artifacts = result.get('task-1')!;
    expect(artifacts.replayConfig).toEqual({
      replayOutputFormat: false,
      replayToolTrace: false,
      replayReasoningChain: true,
    });
  });

  it('preserves replay HITL memory snapshots in resolved artifacts', async () => {
    const replay = makeReplay({
      hitlMemorySnapshots: [{
        interruptId: 'int-1',
        nodeId: 'task-1',
        iteration: 0,
        type: 'clarification',
        blockerKind: 'missing_document',
        reasonCode: 'missing_document',
        prompt: 'Which document?',
        responseAction: 'reply',
        responseMessage: 'Use the signed document.',
        responseScope: 'downstream_run',
        downstreamNodeIds: ['task-2'],
        reusableInReplay: true,
        contextFingerprint: 'hash-1',
      }],
    });
    replayRepository.listActiveForTasks.mockResolvedValue([replay]);

    const result = await service.resolveReplayArtifacts('flow-1', ['task-1']);

    expect(result.get('task-1')?.hitlMemorySnapshots).toEqual([
      expect.objectContaining({
        interruptId: 'int-1',
        reusableInReplay: true,
        contextFingerprint: 'hash-1',
      }),
    ]);
  });

  it('handles multiple tasks with mixed replay presence', async () => {
    replayRepository.listActiveForTasks.mockResolvedValue([makeReplay({ taskId: 'task-1' })]);

    const result = await service.resolveReplayArtifacts('flow-1', ['task-1', 'task-2']);
    expect(result.has('task-1')).toBe(true);
    expect(result.has('task-2')).toBe(false);
  });

  it('resolves a persisted replay artifact by replay identity even when it is no longer active', async () => {
    const replayId = newObjectId();
    replayRepository.findByIdentity.mockResolvedValue(makeReplay({ id: replayId, taskId: 'task-1', validationVersion: 4 }));

    const result = await service.resolveReplayArtifactByIdentity({
      flowId: 'flow-1',
      taskId: 'task-1',
      replayId,
      validationVersion: 4,
    });

    expect(replayRepository.findByIdentity).toHaveBeenCalledWith({
      id: replayId,
      flowId: 'flow-1',
      taskId: 'task-1',
      validationVersion: 4,
    });
    expect(result).toEqual(expect.objectContaining({
      taskId: 'task-1',
      replayId,
      validationVersion: 4,
    }));
  });

  it('returns null when no persisted replay matches the identity', async () => {
    await expect(service.resolveReplayArtifactByIdentity({ flowId: 'flow-1', taskId: 'task-1', replayId: 'replay-9', validationVersion: 2 })).resolves.toBeNull();
  });

  it('resolves the active replay artifact of one task', async () => {
    replayRepository.findActive.mockResolvedValue(makeReplay({ taskId: 'task-3', id: 'replay-3' }));

    const result = await service.resolveActiveReplayArtifact('flow-1', 'task-3');

    expect(replayRepository.findActive).toHaveBeenCalledWith('flow-1', 'task-3');
    expect(result).toEqual(expect.objectContaining({ taskId: 'task-3', replayId: 'replay-3' }));
  });

  it('returns null when the task has no active replay', async () => {
    await expect(service.resolveActiveReplayArtifact('flow-1', 'task-3')).resolves.toBeNull();
  });
});
