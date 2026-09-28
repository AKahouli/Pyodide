import { toGrpcStruct } from './playbook-flow-execution.service';
import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

describe('callGrpcRun replay context and contracts', () => {
  it('passes the raw input context and workspace helpers in the gRPC payload', async () => {
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
      workspaces: ['workspace-1'],
    };
    const { service, agentService } = createExecutionServiceForTests({
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_strict',
          referenceOutput: null,
          outputFormatGuide: null,
          toolCalls: [],
          reasoningChain: [],
          fingerprints: { nodeSnapshotHash: 'node-a' },
          behaviorBaseline: { decisionInvariants: [], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' },
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
        }]]) },
      executionRepository: {
        findById: jest.fn()
          .mockResolvedValueOnce({ executionMode: 'replay_strict', stepExecutionModes: {} })
          .mockResolvedValueOnce({ executionMode: 'replay_strict' })
          .mockResolvedValue({ seededTaskOutputs: [] }),
      },
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, { brief: 'same' }, snapshot);

    const expectedFields = (toGrpcStruct({
      brief: 'same',
      __playbook_workspace_ids: ['workspace-1'],
      __playbook_default_workspace_id: 'workspace-1',
    }) as { fields: Record<string, unknown> }).fields;
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      input_context: expect.objectContaining({
        fields: expect.objectContaining({
          brief: expectedFields.brief,
          __playbook_workspace_ids: expectedFields.__playbook_workspace_ids,
          __playbook_default_workspace_id: expectedFields.__playbook_default_workspace_id,
        }),
      }),
    }));
  });
});
