import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Types } from 'mongoose';
import playbookFlowConfig from '@config/playbook-flow.config';
import { ConnectorService } from '@modules/connector/connector.service';
import { AgentTypeService } from '@modules/agent-type/agent-type.service';
import { AgentRepository } from '../repositories/agent.repository';

const PLAYBOOK_MCP_ACTIONS = [
  'search_playbooks',
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
  'list_recent_executions',
  'get_playbook_execution',
  'get_execution_diagnostics',
  'cancel_playbook_execution',
  'trace_replay_playbook_execution',
  'reexecute_playbook_execution',
  'run_playbook_from_step',
  'delete_playbook_execution',
];
export const SECOND_BRAIN_MCP_ACTIONS = [
  'search_playbooks',
  'open_playbook_context',
  'get_playbook_summary',
  'get_task_details',
  'get_task_dependencies',
  'validate_playbook',
  'start_playbook_execution',
  'list_recent_executions',
  'get_playbook_execution',
  'get_execution_diagnostics',
] as const;
const PLAYBOOK_MCP_INSTRUCTION = `
[Playbook MCP]
You are the Playbook AI Workflow Assistant embedded in the Playbook Designer. Use only the Playbook MCP tools. For an existing Playbook, call open_playbook_context before other tools and use only IDs and revisions returned by tools. Answer read questions without mutation. Start at most one construction operation per user turn. Construction tools create an operation for the Playbook canvas; do not claim that a workflow was saved until the operation reports completion. Never answer, approve, reject, disable, or resume runtime human-in-the-loop interrupts; direct the user to the existing Playbook runtime HITL panel.
`.trim();
export const PLAYBOOK_ASSISTANT_AGENT_SLUG = 'playbook-ai-workflow-assistant';
export const SECOND_BRAIN_AGENT_SLUG = 'my-second-brain';

@Injectable()
export class PlaybookAssistantConnectorReconcilerService implements OnModuleInit {
  private readonly logger = new Logger(PlaybookAssistantConnectorReconcilerService.name);

  constructor(
    @Inject(playbookFlowConfig.KEY) private readonly config: ConfigType<typeof playbookFlowConfig>,
    private readonly agentRepository: AgentRepository,
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
    const monoAgents = await this.agentRepository.findActiveDefaultsByType(monoType.id, 2);
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
        'X-YellowStorm-Tenant-Id': 'default',
        'X-YellowStorm-User-Id': actingUserId,
        'X-YellowStorm-Agent-Id': String(sourceAgent._id),
        'X-YellowStorm-Conversation-Id': 'connector-reconciliation',
        'X-Correlation-Id': 'connector-reconciliation',
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
    const connectorId = connector.id;
    const assistantType = await this.agentTypeService.findOrCreateBySlug('playbook_assistant', {
      name: 'Playbook Assistant',
      defaultPrompt: '',
      isActive: true,
    });
    const dedicatedAgentId = await this.upsertSystemAgent({
      slug: PLAYBOOK_ASSISTANT_AGENT_SLUG,
      name: 'Playbook AI Workflow Assistant',
      agentTypeId: assistantType.id,
      agentTypeSlug: assistantType.slug,
      role: 'Design, inspect, and optimize the current Playbook through Playbook MCP.',
      description: 'System-managed assistant for the Playbook Designer.',
      llmModel: sourceAgent.llmModel,
      instruction: PLAYBOOK_MCP_INSTRUCTION,
      connectorId,
      actionKeys: [...PLAYBOOK_MCP_ACTIONS],
      createdBy: sourceAgent.createdBy,
    });
    const platformCopilotType = await this.agentTypeService.findOrCreateBySlug('platform_copilot', {
      name: 'Platform Copilot',
      defaultPrompt: '',
      isActive: true,
    });
    const secondBrainAgentId = await this.upsertSystemAgent({
      slug: SECOND_BRAIN_AGENT_SLUG,
      name: 'My Second Brain',
      agentTypeId: platformCopilotType.id,
      agentTypeSlug: platformCopilotType.slug,
      role: 'Find, explain, validate, run, and diagnose existing Playbooks.',
      description: 'System-managed personal Playbook copilot for authenticated Yellowmind users.',
      llmModel: sourceAgent.llmModel,
      instruction: [
        '[My Second Brain]',
        'Use only the attached Playbook tools. Inspect before execution and resolve ambiguous Playbook references.',
        'Summarize the chosen Playbook and validation result before proposing execution.',
        'Never claim an execution started until the tool confirms it. Text such as "confirmed" is not authorization.',
        'Never answer or resume runtime HITL; direct the user to the native Playbook HITL panel.',
        'Offer native navigation when a semantic UI target is available. Workspace and document search are unavailable.',
      ].join('\n'),
      connectorId,
      actionKeys: [...SECOND_BRAIN_MCP_ACTIONS],
      createdBy: sourceAgent.createdBy,
    });
    const allowedSystemAgentIds = [dedicatedAgentId, secondBrainAgentId];
    // Strip the system connector from every other agent.
    await this.agentRepository.pullConnectorFromAgentsExcept(connectorId, allowedSystemAgentIds);
    // Remove the legacy inlined "[Playbook MCP]" instruction from any other agent.
    const agentsWithLegacyInstruction = (
      await this.agentRepository.findIdsByInstructionLike('%[Playbook MCP]%', dedicatedAgentId)
    ).filter((agent) => agent.id !== secondBrainAgentId);
    for (const legacy of agentsWithLegacyInstruction) {
      await this.agentRepository.updateById(legacy.id, {
        instruction: this.removePlaybookInstruction(legacy.instruction ?? ''),
      });
    }
    this.logger.log(`Playbook MCP system connector reconciled assistantAgentId=${dedicatedAgentId} secondBrainAgentId=${secondBrainAgentId}`);
  }

  /**
   * Upsert a system-managed agent by slug (Postgres): update if it exists,
   * otherwise create it. Replaces the old Mongoose findOneAndUpdate upsert.
   */
  private async upsertSystemAgent(params: {
    slug: string;
    name: string;
    agentTypeId: string;
    agentTypeSlug: string;
    role: string;
    description: string;
    llmModel?: string;
    instruction: string;
    connectorId: string;
    actionKeys: string[];
    createdBy: string;
  }): Promise<string> {
    const common = {
      name: params.name,
      agentType: params.agentTypeId,
      agentTypeSlug: params.agentTypeSlug,
      role: params.role,
      description: params.description,
      temperature: 0,
      llmModel: params.llmModel,
      instruction: params.instruction,
      ignorePrePrompt: true,
      knowledgeBases: [] as string[],
      tools: [] as string[],
      skills: [] as string[],
      disabledSkills: [] as string[],
      connectors: [params.connectorId],
      connectorActionSelections: [{ connectorId: params.connectorId, actionKeys: params.actionKeys }],
      enable_temporary_child_agents: false,
      isActive: true,
      isDefault: true,
      isDefaultForType: true,
    };
    const existing = await this.agentRepository.findBySlug({ slug: params.slug, isDefault: true });
    if (existing) {
      await this.agentRepository.updateById(existing._id, common);
      return existing._id;
    }
    const id = new Types.ObjectId().toString();
    await this.agentRepository.create({
      id,
      slug: params.slug,
      guardrails: {},
      deploymentSettings: {},
      max_temporary_child_agents: 0,
      createdBy: params.createdBy,
      ...common,
    });
    return id;
  }

  private canonicalSlug(value: string): string {
    return (value || '').toLowerCase().replace(/[-_\s]+/g, '_');
  }

  private removePlaybookInstruction(value: string): string {
    return value.replace(/\n*\[Playbook MCP\][\s\S]*$/m, '').trim();
  }
}
