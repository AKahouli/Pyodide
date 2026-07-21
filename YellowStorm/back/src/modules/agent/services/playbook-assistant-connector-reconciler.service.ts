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
You are the Playbook AI Workflow Assistant embedded in the Playbook Designer. Use only the Playbook MCP tools. For an existing Playbook, call open_playbook_context before other tools and use only IDs and revisions returned by tools. Answer read questions without mutation. Start at most one construction operation per user turn. Construction tools create an operation for the Playbook canvas; do not claim that a workflow was saved until the operation reports completion. Never answer, approve, reject, disable, or resume runtime human-in-the-loop interrupts; direct the user to the existing Playbook runtime HITL panel.
`.trim();
export const PLAYBOOK_ASSISTANT_AGENT_SLUG = 'playbook-ai-workflow-assistant';

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

    const sourceAgent = monoAgents[0];
    const actingUserId = sourceAgent.createdBy.toString();
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
    const assistantType = await this.agentTypeService.findOrCreateBySlug('playbook_assistant', {
      name: 'Playbook Assistant',
      defaultPrompt: '',
      isActive: true,
    });
    const dedicatedAgent = await this.agentModel.findOneAndUpdate(
      { slug: PLAYBOOK_ASSISTANT_AGENT_SLUG, isDefault: true },
      {
        $set: {
          name: 'Playbook AI Workflow Assistant',
          agentType: new Types.ObjectId(assistantType.id),
          role: 'Design, inspect, and optimize the current Playbook through Playbook MCP.',
          description: 'System-managed assistant for the Playbook Designer.',
          llmModel: sourceAgent.llmModel,
          temperature: 0,
          instruction: PLAYBOOK_MCP_INSTRUCTION,
          ignorePrePrompt: true,
          knowledgeBases: [],
          tools: [],
          skills: [],
          disabledSkills: [],
          connectors: [connectorId],
          connectorActionSelections: [{ connector: connectorId, actionKeys: PLAYBOOK_MCP_ACTIONS }],
          enable_temporary_child_agents: false,
          isActive: true,
          isDefault: true,
          isDefaultForType: true,
        },
        $setOnInsert: { createdBy: sourceAgent.createdBy },
      },
      { upsert: true, new: true, setDefaultsOnInsert: false },
    ).exec();
    const dedicatedAgentId = dedicatedAgent.id;
    await this.agentModel.updateMany(
      { _id: { $ne: dedicatedAgentId }, connectors: connectorId },
      { $pull: { connectors: connectorId, connectorActionSelections: { connector: connectorId } } },
    ).exec();
    const agentsWithLegacyInstruction = await this.agentModel.find({
      _id: { $ne: dedicatedAgentId },
      instruction: { $regex: '\\[Playbook MCP\\]' },
    }).select('_id instruction').lean().exec();
    if (agentsWithLegacyInstruction.length > 0) {
      await this.agentModel.bulkWrite(agentsWithLegacyInstruction.map((agent) => ({
        updateOne: {
          filter: { _id: agent._id },
          update: { $set: { instruction: this.removePlaybookInstruction(agent.instruction ?? '') } },
        },
      })));
    }
    this.logger.log(`Playbook MCP system connector attached exclusively to dedicated assistant agentId=${dedicatedAgentId}`);
  }

  private canonicalSlug(value: string): string {
    return (value || '').toLowerCase().replace(/[-_\s]+/g, '_');
  }

  private removePlaybookInstruction(value: string): string {
    return value.replace(/\n*\[Playbook MCP\][\s\S]*$/m, '').trim();
  }
}
