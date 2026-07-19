import { PlaybookAssistantService } from './playbook-assistant.service';

describe('PlaybookAssistantService.runTurn', () => {
  const createService = (overrides: {
    taskResult?: { text: string; toolResults: Array<{ name: string; status: 'completed' | 'failed'; result: unknown }> };
    constructionStatus?: Record<string, unknown>;
  } = {}) => {
    const accessService = { findAccessibleFlow: jest.fn().mockResolvedValue({ definitionRevision: 7 }) };
    const constructionService = {
      getStatus: jest.fn().mockResolvedValue(overrides.constructionStatus ?? {
        operationId: 'operation-1',
        playbookId: 'playbook-1',
        baseDefinitionRevision: 7,
        status: 'running',
        lastSequence: 1,
      }),
    };
    const agentService = { findActiveDefaultAgentIdBySlug: jest.fn().mockResolvedValue('507f1f77bcf86cd799439011') };
    const taskExecutionService = {
      runSingleAgentTask: jest.fn().mockResolvedValue(overrides.taskResult ?? { text: 'This workflow has two tasks.', toolResults: [] }),
    };
    const service = new PlaybookAssistantService(
      { mcpAssistantEnabled: true } as any,
      {} as any,
      accessService as any,
      constructionService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      agentService as any,
      taskExecutionService as any,
    );
    return { service, accessService, constructionService, agentService, taskExecutionService };
  };

  it('returns a read-only assistant answer without creating an operation', async () => {
    const { service, taskExecutionService } = createService();

    await expect(service.runTurn('playbook-1', 'user-1', {
      message: 'How many tasks are there?',
      expectedDefinitionRevision: 7,
      selectedTaskId: 'task-1',
    })).resolves.toEqual({ answer: 'This workflow has two tasks.', operation: null });
    expect(taskExecutionService.runSingleAgentTask).toHaveBeenCalledWith(expect.objectContaining({
      agentId: '507f1f77bcf86cd799439011',
      query: expect.stringContaining('Current Playbook ID: playbook-1'),
    }));
  });

  it('accepts an operation id only from a completed construction tool result and validates ownership', async () => {
    const { service, constructionService } = createService({
      taskResult: {
        text: 'I started the requested update.',
        toolResults: [{
          name: 'playbook-mcp_start_playbook_construction',
          status: 'completed',
          result: { result: { operationId: 'operation-1' } },
        }],
      },
    });

    const result = await service.runTurn('playbook-1', 'user-1', {
      message: 'Add a review task.',
      expectedDefinitionRevision: 7,
    });

    expect(constructionService.getStatus).toHaveBeenCalledWith('playbook-1', 'user-1', 'operation-1');
    expect(result.operation).toEqual(expect.objectContaining({ operationId: 'operation-1', playbookId: 'playbook-1' }));
  });

  it('rejects multiple construction mutations in one assistant turn', async () => {
    const { service } = createService({
      taskResult: {
        text: 'Started two operations.',
        toolResults: [
          { name: 'playbook-mcp_start_playbook_construction', status: 'completed', result: { operationId: 'operation-1' } },
          { name: 'playbook-mcp_start_workflow_optimization', status: 'completed', result: { operationId: 'operation-2' } },
        ],
      },
    });

    await expect(service.runTurn('playbook-1', 'user-1', {
      message: 'Rewrite everything twice.',
      expectedDefinitionRevision: 7,
    })).rejects.toThrow('more than one construction operation');
  });
});
