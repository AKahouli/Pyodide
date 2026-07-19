import { Types } from 'mongoose';
import { PlaybookAssistantConnectorReconcilerService } from './playbook-assistant-connector-reconciler.service';

describe('PlaybookAssistantConnectorReconcilerService', () => {
  it('attaches the hidden system connector only to the single default mono-agent', async () => {
    const connectorId = new Types.ObjectId().toString();
    const agent = {
      id: new Types.ObjectId().toString(),
      createdBy: new Types.ObjectId(),
      connectorActionSelections: [],
    };
    const updateExec = jest.fn().mockResolvedValue({});
    const agentModel = {
      find: jest.fn().mockReturnValue({ limit: () => ({ exec: async () => [agent] }) }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      updateOne: jest.fn().mockReturnValue({ exec: updateExec }),
    };
    const connectorService = {
      reconcilePlaybookMcpSystemConnector: jest.fn().mockResolvedValue({ id: connectorId }),
      inspectMcp: jest.fn().mockResolvedValue({
        tools: [
          'open_playbook_context', 'get_playbook_summary', 'get_task_details', 'get_task_dependencies', 'validate_playbook',
          'start_playbook_construction', 'get_playbook_construction', 'cancel_playbook_construction', 'analyze_task_optimization',
          'start_advisor_remediation_construction', 'analyze_workflow_optimization', 'start_workflow_optimization', 'create_playbook',
          'clone_playbook', 'revert_playbook_construction', 'start_playbook_execution', 'list_playbook_executions',
          'get_playbook_execution', 'cancel_playbook_execution', 'trace_replay_playbook_execution', 'reexecute_playbook_execution',
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
      agentModel as any,
      { findAllActive: jest.fn().mockResolvedValue([{ id: new Types.ObjectId().toString(), slug: 'mono-agent' }]) } as any,
      connectorService as any,
    );

    await service.onModuleInit();

    expect(connectorService.reconcilePlaybookMcpSystemConnector).toHaveBeenCalledWith(
      agent.createdBy.toString(),
      'http://playbook-mcp:8025/mcp',
    );
    expect(agentModel.updateOne).toHaveBeenCalledWith(
      { _id: agent.id, isDefault: true, isActive: true },
      expect.objectContaining({
        $addToSet: { connectors: new Types.ObjectId(connectorId) },
        $set: expect.objectContaining({
          connectorActionSelections: [expect.objectContaining({ actionKeys: expect.arrayContaining(['start_playbook_construction']) })],
          instruction: expect.stringContaining('[Playbook MCP]'),
        }),
      }),
    );
    expect(updateExec).toHaveBeenCalled();
    expect(agentModel.updateMany).toHaveBeenCalledWith(
      { _id: { $ne: agent.id }, connectors: new Types.ObjectId(connectorId) },
      { $pull: { connectors: new Types.ObjectId(connectorId), connectorActionSelections: { connector: new Types.ObjectId(connectorId) } } },
    );
  });

  it('fails closed when more than one default mono-agent exists', async () => {
    const agentModel = {
      find: jest.fn().mockReturnValue({ limit: () => ({ exec: async () => [{}, {}] }) }),
      updateOne: jest.fn(),
    };
    const connectorService = { reconcilePlaybookMcpSystemConnector: jest.fn(), inspectMcp: jest.fn() };
    const service = new PlaybookAssistantConnectorReconcilerService(
      { mcpAssistantEnabled: true, mcpConnectorReconciliationEnabled: true, mcpIngressToken: 'configured' } as any,
      agentModel as any,
      { findAllActive: jest.fn().mockResolvedValue([{ id: new Types.ObjectId().toString(), slug: 'mono-agent' }]) } as any,
      connectorService as any,
    );

    await service.onModuleInit();

    expect(connectorService.reconcilePlaybookMcpSystemConnector).not.toHaveBeenCalled();
    expect(agentModel.updateOne).not.toHaveBeenCalled();
  });
});
