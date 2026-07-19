import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import playbookFlowConfig from '@config/playbook-flow.config';
import { ConnectorService } from '@modules/connector/connector.service';
import { AgentTypeService } from '@modules/agent-type/agent-type.service';
import { Agent, AgentDocument } from '../schemas/agent.schema';

const PLAYBOOK_MCP_ACTIONS = [
  'open_playbook_context',
  'get_playbook_summary',
  'get_task_details',
  'get_task_dependencies',
  'validate_playbook',
  'start_playbook_construction',
  'get_playbook_construction',
  'cancel_playbook_construction',
  'analyze_task_optimization',
  'start_advisor_remediation_construction',
  'analyze_workflow_optimization',
  'start_workflow_optimization',
  'create_playbook',
  'clone_playbook',
  'revert_playbook_construction',
  'start_playbook_execution',
  'list_playbook_executions',
  'get_playbook_execution',
  'cancel_playbook_execution',
  'trace_replay_playbook_execution',
  'reexecute_playbook_execution',
  'run_playbook_from_step',
  'delete_playbook_execution',
];
const PLAYBOOK_MCP_INSTRUCTION = `
[Playbook MCP]
When a request concerns an existing Playbook, call open_playbook_context before other Playbook tools and use only IDs and revisions returned by the tools. Read tools never mutate. Construction tools create an operation for the Playbook canvas; do not claim that a workflow was saved until the operation reports completion. Never use Playbook tools to answer, approve, reject, or resume runtime human-in-the-loop interrupts; direct the user to the existing Playbook runtime HITL panel.
`.trim();

@Injectable()
export class PlaybookAssistantConnectorReconcilerService implements OnModuleInit {
  private readonly logger = new Logger(PlaybookAssistantConnectorReconcilerService.name);

  constructor(
    @Inject(playbookFlowConfig.KEY) private readonly config: ConfigType<typeof playbookFlowConfig>,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    private readonly agentTypeService: AgentTypeService,
    private readonly connectorService: ConnectorService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.mcpAssistantEnabled || !this.config.mcpConnectorReconciliationEnabled) return;
    if (!this.config.mcpIngressToken) {
      this.logger.error('Playbook MCP connector reconciliation skipped: ingress token is missing');
      return;
    }

    const agentTypes = await this.agentTypeService.findAllActive();
    const monoType = agentTypes.find((type) => this.canonicalSlug(type.slug) === 'mono_agent');
    if (!monoType) {
      this.logger.error('Playbook MCP connector reconciliation skipped: mono-agent type is missing');
      return;
    }
    const monoAgents = await this.agentModel.find({
      agentType: new Types.ObjectId(monoType.id),
      isDefault: true,
      isActive: true,
    }).limit(2).exec();
    if (monoAgents.length !== 1) {
      this.logger.error(`Playbook MCP connector reconciliation skipped: expected one default mono-agent, found ${monoAgents.length}`);
      return;
    }

    const agent = monoAgents[0];
    const actingUserId = agent.createdBy.toString();
    const inspection = await this.connectorService.inspectMcp(
      'streamable_http',
      this.config.mcpServerUrl,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      {
        'X-Playbook-MCP-Token': this.config.mcpIngressToken,
        'X-YellowStorm-User-Id': actingUserId,
      },
    );
    const liveTools = inspection.tools.map((tool) => tool.name).sort();
    const expectedTools = [...PLAYBOOK_MCP_ACTIONS].sort();
    if (inspection.error || JSON.stringify(liveTools) !== JSON.stringify(expectedTools)) {
      this.logger.error(`Playbook MCP connector reconciliation skipped: live tool inventory mismatch expected=${expectedTools.length} actual=${liveTools.length}`);
      return;
    }
    const connector = await this.connectorService.reconcilePlaybookMcpSystemConnector(
      actingUserId,
      this.config.mcpServerUrl,
    );
    const connectorId = new Types.ObjectId(connector.id);
    const selections = (agent.connectorActionSelections ?? [])
      .filter((selection) => selection.connector.toString() !== connector.id);
    selections.push({ connector: connectorId, actionKeys: PLAYBOOK_MCP_ACTIONS });
    const instruction = agent.instruction?.includes('[Playbook MCP]')
      ? agent.instruction
      : `${agent.instruction?.trim() ?? ''}\n\n${PLAYBOOK_MCP_INSTRUCTION}`.trim();
    await this.agentModel.updateMany(
      { _id: { $ne: agent.id }, connectors: connectorId },
      { $pull: { connectors: connectorId, connectorActionSelections: { connector: connectorId } } },
    ).exec();
    await this.agentModel.updateOne(
      { _id: agent.id, isDefault: true, isActive: true },
      {
        $addToSet: { connectors: connectorId },
        $set: { connectorActionSelections: selections, instruction },
      },
    ).exec();
    this.logger.log(`Playbook MCP system connector attached to default mono-agent agentId=${agent.id}`);
  }

  private canonicalSlug(value: string): string {
    return (value || '').toLowerCase().replace(/[-_\s]+/g, '_');
  }
}
