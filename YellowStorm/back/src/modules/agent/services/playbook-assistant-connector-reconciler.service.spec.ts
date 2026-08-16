import { Types } from 'mongoose';
import { PlaybookAssistantConnectorReconcilerService } from './playbook-assistant-connector-reconciler.service';

describe('PlaybookAssistantConnectorReconcilerService', () => {
  it('attaches the hidden system connector only to the dedicated Playbook assistant', async () => {
    const connectorId = new Types.ObjectId().toString();
    const sourceAgent = {
      _id: new Types.ObjectId().toString(),
      createdBy: new Types.ObjectId().toString(),
      llmModel: '',
    };
    const agentRepository = {
      findActiveDefaultsByType: jest.fn().mockResolvedValue([sourceAgent]),
      upsertDefaultSystemAgent: jest.fn()
        .mockImplementationOnce(async (input) => ({ _id: input.id }))
        .mockImplementationOnce(async (input) => ({ _id: input.id })),
      updateById: jest.fn().mockResolvedValue(undefined),
      pullConnectorFromAllExcept: jest.fn().mockResolvedValue(undefined),
      findIdsByInstructionLike: jest.fn().mockResolvedValue([]),
    };
    const connectorService = {
      reconcilePlaybookMcpSystemConnector: jest.fn().mockResolvedValue({ id: connectorId }),
      inspectMcp: jest.fn().mockResolvedValue({
        tools: [
          'search_playbooks', 'open_playbook_context', 'get_playbook_summary', 'get_task_details', 'get_task_dependencies', 'validate_playbook',
          'assess_playbook_request', 'continue_playbook_clarification',
          'start_playbook_construction', 'start_playbook_generation', 'get_playbook_construction', 'cancel_playbook_construction', 'analyze_task_optimization',
          'start_advisor_remediation_construction', 'analyze_workflow_optimization', 'start_workflow_optimization', 'create_playbook',
          'clone_playbook', 'revert_playbook_construction', 'start_playbook_execution', 'list_playbook_executions',
          'list_recent_executions', 'get_playbook_execution', 'get_execution_diagnostics', 'cancel_playbook_execution', 'trace_replay_playbook_execution', 'reexecute_playbook_execution',
          'run_playbook_from_step', 'delete_playbook_execution',
        ].map((name) => ({ name })),
      }),
    };
    const service = new PlaybookAssistantConnectorReconcilerService(
      {
        mcpAssistantEnabled: true,
        mcpConnectorReconciliationEnabled: true,
        mcpIngressToken: 'configured',
        mcpServerUrl: 'http://playbook-mcp:8025/mcp',
      } as any,
      agentRepository as any,
      {
        findAllActive: jest.fn().mockResolvedValue([{ id: new Types.ObjectId().toString(), slug: 'mono-agent' }]),
        findOrCreateBySlug: jest.fn()
          .mockResolvedValueOnce({ id: new Types.ObjectId().toString(), slug: 'playbook_assistant' })
          .mockResolvedValueOnce({ id: new Types.ObjectId().toString(), slug: 'platform_copilot' }),
      } as any,
      connectorService as any,
    );

    await service.onModuleInit();

    expect(connectorService.inspectMcp).toHaveBeenCalledWith(
      'streamable_http',
      'http://playbook-mcp:8025/mcp',
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      expect.objectContaining({ Authorization: 'Bearer configured' }),
    );
    expect(connectorService.reconcilePlaybookMcpSystemConnector).toHaveBeenCalledWith(
      sourceAgent.createdBy,
      'http://playbook-mcp:8025/mcp',
    );
    // No existing dedicated agent -> created fresh with the system connector attached exclusively.
    expect(agentRepository.upsertDefaultSystemAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'playbook-ai-workflow-assistant',
        name: 'Yellowmind Playbook Designer',
        isDefault: true,
        connectors: [connectorId],
        connectorActionSelections: [expect.objectContaining({ connectorId, actionKeys: expect.arrayContaining(['start_playbook_construction']) })],
        instruction: expect.stringContaining('[Playbook MCP]'),
      }),
    );
    expect(agentRepository.upsertDefaultSystemAgent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        slug: 'my-second-brain',
        name: 'Yellowmind',
        instruction: expect.stringContaining('exactly once for the current turn'),
      }),
    );
    expect(agentRepository.upsertDefaultSystemAgent.mock.calls[1][0].instruction)
      .not.toContain('trusted assistant request ID');
    const designerActions = agentRepository.upsertDefaultSystemAgent.mock.calls[0][0].connectorActionSelections[0].actionKeys;
    expect(designerActions).toContain('start_playbook_construction');
    expect(designerActions).not.toEqual(expect.arrayContaining([
      'create_playbook',
      'clone_playbook',
      'start_playbook_execution',
      'cancel_playbook_execution',
      'reexecute_playbook_execution',
      'run_playbook_from_step',
      'delete_playbook_execution',
    ]));
    // The connector is pulled from every other agent (all but the dedicated one).
    expect(agentRepository.pullConnectorFromAllExcept).toHaveBeenCalledWith(
      connectorId,
      expect.arrayContaining([expect.any(String), expect.any(String)]),
    );
  });

  it('fails closed when more than one default mono-agent exists', async () => {
    const agentRepository = {
      findActiveDefaultsByType: jest.fn().mockResolvedValue([{}, {}]),
      upsertDefaultSystemAgent: jest.fn(),
    };
    const connectorService = { reconcilePlaybookMcpSystemConnector: jest.fn(), inspectMcp: jest.fn() };
    const service = new PlaybookAssistantConnectorReconcilerService(
      { mcpAssistantEnabled: true, mcpConnectorReconciliationEnabled: true, mcpIngressToken: 'configured' } as any,
      agentRepository as any,
      { findAllActive: jest.fn().mockResolvedValue([{ id: new Types.ObjectId().toString(), slug: 'mono-agent' }]) } as any,
      connectorService as any,
    );

    await service.onModuleInit();

    expect(connectorService.reconcilePlaybookMcpSystemConnector).not.toHaveBeenCalled();
    expect(agentRepository.upsertDefaultSystemAgent).not.toHaveBeenCalled();
  });
});
