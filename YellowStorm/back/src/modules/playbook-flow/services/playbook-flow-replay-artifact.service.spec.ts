import { PlaybookFlowReplayArtifactService } from './playbook-flow-replay-artifact.service';
import type { FlowValidatedReplayDocument } from '../schemas/playbook-flow-validated-replay.schema';

function makeReplay(overrides: Partial<FlowValidatedReplayDocument> = {}): any {
  return {
    taskId: overrides.taskId ?? 'task-1',
    _id: overrides._id ?? 'replay-1',
    validationVersion: overrides.validationVersion ?? 1,
    referenceOutput: overrides.referenceOutput ?? 'baseline output',
    outputFormatGuide: overrides.outputFormatGuide ?? null,
    toolCalls: overrides.toolCalls ?? [],
    reasoningChain: overrides.reasoningChain ?? [],
    replayConfig: overrides.replayConfig ?? { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
  };
}

describe('PlaybookFlowReplayArtifactService', () => {
  let service: PlaybookFlowReplayArtifactService;
  let replayModel: { find: jest.Mock };

  beforeEach(() => {
    replayModel = { find: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }) };
    service = new PlaybookFlowReplayArtifactService(
      replayModel as any,
      { setContext: jest.fn() } as any,
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
    expect(artifacts.referenceOutput).toBe('ref output');
    expect(artifacts.outputFormatGuide).toBe('format guide');
    expect(artifacts.toolCalls).toHaveLength(1);
    expect(artifacts.reasoningChain).toHaveLength(1);
    expect(artifacts.replayConfig.replayOutputFormat).toBe(true);
    expect(artifacts.replayConfig.replayReasoningChain).toBe(true);
    expect(artifacts.replayConfig.replayToolTrace).toBe(false);
  });

  it('defaults missing replayConfig fields to false', async () => {
    const replay = makeReplay({ replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false } });
    replayModel.find.mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([replay]) }) });

    const result = await service.resolveReplayArtifacts('flow-1', ['task-1']);
    const artifacts = result.get('task-1')!;
    expect(artifacts.replayConfig).toEqual({
      replayOutputFormat: false,
      replayToolTrace: false,
      replayReasoningChain: false,
    });
  });

  it('handles multiple tasks with mixed replay presence', async () => {
    const replay = makeReplay({ taskId: 'task-1' });
    replayModel.find.mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([replay]) }) });

    const result = await service.resolveReplayArtifacts('flow-1', ['task-1', 'task-2']);
    expect(result.has('task-1')).toBe(true);
    expect(result.has('task-2')).toBe(false);
  });
});
