import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { PlaybookFlowAdvisorScriptReplacementService } from './playbook-flow-advisor-script-replacement.service';

const FLOW_ID = '64b000000000000000000002';
const OWNER_ID = '64b000000000000000000003';
const EXECUTION_ID = '64b000000000000000000001';

const node = { id: 'task-1', kind: 'step', label: 'Format', metadata: { description: 'd' }, output: { ports: [{ id: 'summary' }] } };
const SCRIPT = 'def run(inputs: dict) -> dict:\n    return {\n        "summary": inputs.get("summary"),\n    }\n';

function createService() {
  const flowRepository = {
    findOwned: jest.fn().mockResolvedValue({ id: FLOW_ID, ownerId: OWNER_ID, definitionRevision: 4, nodes: [node, { id: 'task-2', kind: 'step' }] }),
    updateFields: jest.fn().mockResolvedValue({ id: FLOW_ID, definitionRevision: 5 }),
  };
  const executionRepository = {
    findOwned: jest.fn().mockResolvedValue({ id: EXECUTION_ID, flowId: FLOW_ID, ownerId: OWNER_ID }),
  };
  const taskResultRepository = {
    findLatestForTask: jest.fn().mockResolvedValue({ id: 'tr-1', status: 'completed', judgeResult: { estimatedTokenReductionPct: 40 } }),
  };
  const service = new PlaybookFlowAdvisorScriptReplacementService(flowRepository as never, executionRepository as never, taskResultRepository as never);
  return { service, flowRepository, executionRepository, taskResultRepository };
}

describe('PlaybookFlowAdvisorScriptReplacementService', () => {
  it('previews the script candidate of the node from its latest completed result', async () => {
    const { service, flowRepository, executionRepository, taskResultRepository } = createService();

    const preview = await service.preview(FLOW_ID, OWNER_ID, { executionId: EXECUTION_ID, targetTaskId: 'task-1' } as never);

    expect(flowRepository.findOwned).toHaveBeenCalledWith(FLOW_ID, OWNER_ID);
    expect(executionRepository.findOwned).toHaveBeenCalledWith(EXECUTION_ID, OWNER_ID);
    expect(taskResultRepository.findLatestForTask).toHaveBeenCalledWith(EXECUTION_ID, 'task-1');
    expect(preview).toMatchObject({
      targetTaskId: 'task-1',
      candidate: { script: SCRIPT, outputContract: { ports: [{ id: 'summary' }], raw: '' } },
      validation: { status: 'passed' },
      estimatedTokenReductionPct: 40,
    });
  });

  it('applies the script under the revision guard and bumps the revision', async () => {
    const { service, flowRepository } = createService();

    const result = await service.apply(FLOW_ID, OWNER_ID, { executionId: EXECUTION_ID, targetTaskId: 'task-1', script: SCRIPT } as never);

    expect(result).toEqual({ targetTaskId: 'task-1', scriptHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), definitionRevision: 5 });
    const [flowId, patch, options] = flowRepository.updateFields.mock.calls[0];
    expect(flowId).toBe(FLOW_ID);
    expect(options).toEqual({ ownerId: OWNER_ID, expectedRevision: 4, incrementRevision: true });
    expect(patch.nodes[1]).toEqual({ id: 'task-2', kind: 'step' });
    expect(patch.nodes[0].metadata).toEqual({
      description: 'd',
      executionStrategy: 'deterministic_script',
      scriptRuntime: 'python3.11',
      scriptEntrypoint: 'run',
      scriptSource: { kind: 'advisor_generated', language: 'python', code: SCRIPT, sha256: result.scriptHash },
      scriptValidation: expect.objectContaining({
        status: 'passed', appliedAt: expect.any(String), appliedFromExecutionId: EXECUTION_ID, appliedFromTaskResultId: 'tr-1',
      }),
    });
  });

  it('conflicts when the flow changed since the preview', async () => {
    const { service, flowRepository } = createService();
    flowRepository.updateFields.mockResolvedValue(null);

    await expect(service.apply(FLOW_ID, OWNER_ID, { executionId: EXECUTION_ID, targetTaskId: 'task-1', script: SCRIPT } as never))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('only applies the server-generated script', async () => {
    const { service, flowRepository } = createService();

    await expect(service.apply(FLOW_ID, OWNER_ID, { executionId: EXECUTION_ID, targetTaskId: 'task-1', script: 'import os' } as never))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(flowRepository.updateFields).not.toHaveBeenCalled();
  });

  it('hides a run of another flow, and needs a completed task result', async () => {
    const { service, executionRepository, taskResultRepository } = createService();
    executionRepository.findOwned.mockResolvedValue({ id: EXECUTION_ID, flowId: '64b0000000000000000000ff', ownerId: OWNER_ID });
    await expect(service.preview(FLOW_ID, OWNER_ID, { executionId: EXECUTION_ID, targetTaskId: 'task-1' } as never))
      .rejects.toThrow('Execution not found');

    executionRepository.findOwned.mockResolvedValue({ id: EXECUTION_ID, flowId: FLOW_ID, ownerId: OWNER_ID });
    taskResultRepository.findLatestForTask.mockResolvedValue({ id: 'tr-1', status: 'failed' });
    await expect(service.preview(FLOW_ID.toUpperCase(), OWNER_ID, { executionId: EXECUTION_ID, targetTaskId: 'task-1' } as never))
      .rejects.toBeInstanceOf(BadRequestException);

    taskResultRepository.findLatestForTask.mockResolvedValue(null);
    await expect(service.preview(FLOW_ID, OWNER_ID, { executionId: EXECUTION_ID, targetTaskId: 'task-1' } as never))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
