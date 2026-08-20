import { Types } from 'mongoose';
import { PlaybookAssistantConnectorReconcilerService } from './playbook-assistant-connector-reconciler.service';

describe('PlaybookAssistantConnectorReconcilerService', () => {
  it('attaches the hidden system connector exclusively to the Yellowmind second-brain agent', async () => {
    const connectorId = new Types.ObjectId().toString();
    const sourceAgent = {
      _id: new Types.ObjectId().toString(),
      createdBy: new Types.ObjectId().toString(),
      llmModel: '',
    };
    const agentRepository = {
      findActiveDefaultsByType: jest.fn().mockResolvedValue([sourceAgent]),
      upsertDefaultSystemAgent: jest.fn()
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
          'assess_playbook_request', 'modify_playbook', 'continue_playbook_clarification',
          'start_playbook_construction', 'start_playbook_generation', 'get_playbook_construction', 'cancel_playbook_construction', 'analyze_task_optimization',
          'start_advisor_remediation_construction', 'analyze_workflow_optimization', 'start_workflow_optimization', 'create_playbook',
          'clone_playbook', 'revert_playbook_construction', 'start_playbook_execution', 'list_playbook_executions',
          'list_recent_executions', 'get_playbook_execution', 'get_execution_diagnostics', 'cancel_playbook_execution', 'trace_replay_playbook_execution', 'reexecute_playbook_execution',
          'run_playbook_from_step', 'delete_playbook_execution',
        ].map((name) => ({ name, description: '', inputSchema: {} })),
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
    expect(connectorService.inspectMcp.mock.calls[0][7]).not.toHaveProperty('X-YellowStorm-Tenant-Id');
    expect(connectorService.reconcilePlaybookMcpSystemConnector).toHaveBeenCalledWith(
      sourceAgent.createdBy,
      'http://playbook-mcp:8025/mcp',
      expect.arrayContaining([expect.objectContaining({ name: 'modify_playbook' })]),
    );
    // The dedicated designer agent is retired: only the Yellowmind second-brain agent is reconciled.
    expect(agentRepository.upsertDefaultSystemAgent).toHaveBeenCalledTimes(1);
    expect(agentRepository.upsertDefaultSystemAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'my-second-brain',
        name: 'Yellowmind',
        isDefault: true,
        connectors: [connectorId],
        connectorActionSelections: [expect.objectContaining({
          connectorId,
          actionKeys: expect.arrayContaining([
            'start_playbook_construction',
            'assess_playbook_request',
            'continue_playbook_clarification',
            'start_advisor_remediation_construction',
            'start_playbook_execution',
          ]),
        })],
        instruction: expect.stringContaining('exactly once for the current turn'),
      }),
    );
    const secondBrainInstruction = agentRepository.upsertDefaultSystemAgent.mock.calls[0][0].instruction;
    expect(secondBrainInstruction).toContain('open_playbook_context');
    expect(secondBrainInstruction).toContain('modify_playbook');
    expect(secondBrainInstruction).toContain('runtime HITL');
    expect(secondBrainInstruction).toContain('no manual confirmation step');
    expect(secondBrainInstruction).toContain('do not call present_choices');
    expect(secondBrainInstruction).toContain('skip the remaining questions');
    const actionKeys = agentRepository.upsertDefaultSystemAgent.mock.calls[0][0].connectorActionSelections[0].actionKeys;
    expect(actionKeys).toContain('start_playbook_construction');
    expect(actionKeys).toContain('modify_playbook');
    // Existing agents keep their stored instruction on upsert; the reconciler must resync it.
    expect(agentRepository.updateById).toHaveBeenCalledWith(
      expect.any(String),
      { instruction: secondBrainInstruction },
    );
    // The connector is pulled from every other agent (only the second brain keeps it).
    expect(agentRepository.pullConnectorFromAllExcept).toHaveBeenCalledWith(
      connectorId,
      expect.arrayContaining([expect.any(String)]),
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
