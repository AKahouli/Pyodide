import { PlaybookFlowOutputFormatService } from './playbook-flow-output-format.service';
import type { OutputFormatRecord } from '../persistence/output-format.repository';

const flowId = '6a272d051f4e6f361ed9846d';
const executionId = '6ab61962228a7b6acbe18189';
const userId = '507f1f77bcf86cd799439011';

function template(overrides: Partial<OutputFormatRecord> = {}): OutputFormatRecord {
  return {
    id: '6a390761afb372bc326288b5', flowId, nodeId: 'task-1', createdBy: userId, sourceExecutionId: executionId,
    sourceExecutionNumber: 1, templateVersion: 1, status: 'active', generationStatus: 'pending', generationError: null,
    sourceOutput: '# Report', formatGuide: null, llmPromptTrace: [],
    createdAt: new Date('2026-09-24T08:00:00.000Z'), updatedAt: new Date('2026-09-24T08:00:00.000Z'),
    ...overrides,
  };
}

describe('PlaybookFlowOutputFormatService', () => {
  const setup = (over: { execution?: unknown; taskResult?: unknown } = {}) => {
    const outputFormats = {
      capture: jest.fn().mockImplementation(async (input) => template({ sourceOutput: input.sourceOutput })),
      findById: jest.fn().mockResolvedValue(template()),
      setGeneration: jest.fn().mockImplementation(async (_id, generation) => template(generation)),
      findActive: jest.fn(),
      listActive: jest.fn(),
      updateActive: jest.fn(),
      archiveActive: jest.fn(),
    };
    const executions = { findById: jest.fn().mockResolvedValue('execution' in over ? over.execution : { id: executionId, flowId }) };
    const taskResults = { findLatestForTask: jest.fn().mockResolvedValue('taskResult' in over ? over.taskResult : { output: '# Report' }) };
    const liteLLM = { getHttpClient: jest.fn().mockReturnValue(null) };
    const streamGateway = { sendToUser: jest.fn() };
    const logger = { setContext: jest.fn(), warn: jest.fn() };
    const service = new PlaybookFlowOutputFormatService(
      outputFormats as any, executions as any, taskResults as any, {} as any, liteLLM as any, streamGateway as any, {} as any, logger as any,
    );
    return { service, outputFormats, executions, taskResults, streamGateway };
  };

  it('captures the latest completed output of the node and generates its guide in the background', async () => {
    const { service, outputFormats, taskResults, streamGateway } = setup();

    const response = await service.captureFromExecution(userId, flowId, 'task-1', executionId);

    expect(taskResults.findLatestForTask).toHaveBeenCalledWith(executionId, 'task-1', { statuses: ['completed'], light: true, with: ['output'] });
    expect(outputFormats.capture).toHaveBeenCalledWith({
      flowId, nodeId: 'task-1', createdBy: userId, sourceExecutionId: executionId, sourceExecutionNumber: 1, sourceOutput: '# Report',
    });
    expect(response).toMatchObject({ flowId, nodeId: 'task-1', templateVersion: 1, status: 'active', generationStatus: 'pending', createdAt: '2026-09-24T08:00:00.000Z' });

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(outputFormats.setGeneration).toHaveBeenCalledWith(response.id, expect.objectContaining({ generationStatus: 'ready', generationError: null }));
    expect(streamGateway.sendToUser).toHaveBeenCalledWith(userId, expect.objectContaining({
      type: 'playbook_output_format_template_updated',
      data: expect.objectContaining({ playbookId: flowId, taskId: 'task-1' }),
    }));
  });

  it('keeps a structured task output as JSON text', async () => {
    const { service, outputFormats } = setup({ taskResult: { output: { rows: [1] } } });
    await service.captureFromExecution(userId, flowId, 'task-1', executionId);
    expect(outputFormats.capture).toHaveBeenCalledWith(expect.objectContaining({ sourceOutput: '{"rows":[1]}' }));
  });

  it('refuses a run of another flow and a node without a completed output', async () => {
    await expect(setup({ execution: { id: executionId, flowId: '6ab61962228a7b6acbe18180' } }).service.captureFromExecution(userId, flowId, 'task-1', executionId))
      .rejects.toMatchObject({ status: 404 });
    await expect(setup({ execution: null }).service.captureFromExecution(userId, flowId, 'task-1', executionId))
      .rejects.toMatchObject({ status: 404 });
    const empty = setup({ taskResult: { output: '' } });
    await expect(empty.service.captureFromExecution(userId, flowId, 'task-1', executionId)).rejects.toMatchObject({ status: 400 });
    expect(empty.outputFormats.capture).not.toHaveBeenCalled();
  });

  it('reads, edits and archives the active template of a node', async () => {
    const { service, outputFormats } = setup();
    outputFormats.findActive.mockResolvedValueOnce(template()).mockResolvedValueOnce(null);
    expect(await service.getActiveTemplate(flowId, 'task-1')).toMatchObject({ id: template().id });
    expect(await service.getActiveTemplate(flowId, 'task-1')).toBeNull();

    outputFormats.updateActive.mockResolvedValueOnce(template({ formatGuide: 'g' })).mockResolvedValueOnce(null);
    expect(await service.updateTemplate(flowId, 'task-1', { formatGuide: 'g' })).toMatchObject({ formatGuide: 'g' });
    expect(outputFormats.updateActive).toHaveBeenCalledWith(flowId, 'task-1', { formatGuide: 'g' });
    expect(await service.updateTemplate(flowId, 'task-1', {})).toBeNull();

    await service.deleteTemplate(flowId, 'task-1');
    expect(outputFormats.archiveActive).toHaveBeenCalledWith(flowId, 'task-1');

    outputFormats.listActive.mockResolvedValueOnce([template({ nodeId: 'a' }), template({ nodeId: 'b' })]);
    expect([...(await service.getActiveTemplates(flowId, ['a', 'b'])).keys()]).toEqual(['a', 'b']);
    expect((await service.getActiveTemplates(flowId, [])).size).toBe(0);
  });
});
