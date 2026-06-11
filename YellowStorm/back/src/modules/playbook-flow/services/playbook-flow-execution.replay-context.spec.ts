import { toGrpcStruct } from './playbook-flow-execution.service';
import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

describe('callGrpcRun replay context and contracts', () => {
  it('uses raw input context for replay eligibility while keeping workspace helpers in the gRPC payload', async () => {
    const replayEligibilityService = {
      evaluateReplayEligibility: jest.fn().mockReturnValue({
        applied: true,
        confidenceScore: 100,
        confidenceFactors: {},
        invalidationReasons: [],
        appliedSections: [],
        skippedSections: [],
      }),
    };
    const replayBaselineService = {
      buildCurrentReplayFingerprints: jest.fn().mockReturnValue({
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-a',
        nodeSnapshotHash: 'node-a',
        agentConfigHash: null,
        modelConfigHash: 'model-a',
        toolConfigHash: null,
        outputContractHash: null,
      }),
    };
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
      replayBaselineService,
      replayEligibilityService,
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', stepExecutionModes: {} }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict' }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, { brief: 'same' }, snapshot);

    expect(replayBaselineService.buildCurrentReplayFingerprints).toHaveBeenCalledWith(expect.objectContaining({
      inputContext: { brief: 'same' },
    }));
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

  it('derives replay eligibility output contracts from the current active output format template', async () => {
    const currentOutputContract = {
      type: 'markdown_sections',
      requiredSections: ['Summary'],
      forbiddenSections: [],
      jsonSchema: null,
      citationPolicy: 'required',
    };
    const replayBaselineService = {
      buildOutputContractFromReplay: jest.fn().mockReturnValue(currentOutputContract),
      buildCurrentReplayFingerprints: jest.fn().mockReturnValue({ outputContractHash: 'contract-b' }),
    };
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
          mode: 'replay_flex',
          referenceOutput: '# Summary\nHello',
          outputFormatGuide: 'Old guide',
          toolCalls: [],
          reasoningChain: [],
          fingerprints: { outputContractHash: 'contract-a' },
          behaviorBaseline: null,
          toolPolicy: null,
          outputContract: { type: 'freeform', requiredSections: [], forbiddenSections: [], jsonSchema: null, citationPolicy: 'optional' },
          replayConfig: { replayOutputFormat: true, replayToolTrace: false, replayReasoningChain: false },
        }]]) },
      replayBaselineService,
      replayEligibilityService: {
        evaluateReplayEligibility: jest.fn().mockReturnValue({
          applied: false,
          confidenceScore: 0,
          confidenceFactors: {},
          invalidationReasons: ['output_contract_mismatch'],
          appliedSections: [],
          skippedSections: [],
        }),
      },
      outputFormatService: {
        getActiveTemplates: jest.fn().mockResolvedValue(new Map([['step-1', { formatGuide: 'Use a Summary section with citations.' }]])),
      },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_flex', stepExecutionModes: {} }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_flex' }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
    });
    (service as any).playbookFlowClient = { Run: jest.fn().mockReturnValue({ on: jest.fn() }) };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, { brief: 'same' }, snapshot);

    expect(replayBaselineService.buildOutputContractFromReplay).toHaveBeenCalledWith({
      output: '# Summary\nHello',
      preserveOutputFormat: true,
      outputFormatGuide: 'Use a Summary section with citations.',
      existingOutputContract: {
        type: 'freeform',
        requiredSections: [],
        forbiddenSections: [],
        jsonSchema: null,
        citationPolicy: 'optional',
      },
    });
    expect(replayBaselineService.buildCurrentReplayFingerprints).toHaveBeenCalledWith(expect.objectContaining({
      outputContract: currentOutputContract,
    }));
  });
});
