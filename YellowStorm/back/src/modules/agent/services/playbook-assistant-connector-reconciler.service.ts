import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Types } from 'mongoose';
import playbookFlowConfig from '@config/playbook-flow.config';
import { ConnectorService } from '@modules/connector/connector.service';
import { AgentTypeService } from '@modules/agent-type/agent-type.service';
import { AgentRepository } from '../repositories/agent.repository';

export const SECOND_BRAIN_MCP_ACTIONS = [
  'search_playbooks',
  'open_playbook_context',
  'get_playbook_summary',
  'get_task_details',
  'get_task_dependencies',
  'validate_playbook',
  'assess_playbook_request',
  'modify_playbook',
  'continue_playbook_clarification',
  'start_playbook_construction',
  'start_playbook_generation',
  'get_playbook_construction',
  'cancel_playbook_construction',
  'revert_playbook_construction',
  'analyze_task_optimization',
  'analyze_workflow_optimization',
  'start_workflow_optimization',
  'start_advisor_remediation_construction',
  'start_playbook_execution',
  'list_recent_executions',
  'get_playbook_execution',
  'get_execution_diagnostics',
] as const;
export const SECOND_BRAIN_AGENT_SLUG = 'my-second-brain';

export const SECOND_BRAIN_AGENT_INSTRUCTION = [
  '[Yellowmind]',
  'Use only the attached Playbook tools. Inspect before execution and resolve ambiguous Playbook references.',
  'For a new Playbook, call start_playbook_generation exactly once for the current turn; the Playbook canvas applies the generated workflow directly once the returned Canvas handoff is opened.',
  'For an existing Playbook, call open_playbook_context first, then modify_playbook with the Playbook ID to assess the current user turn; when clarification questions are returned, ask the user and call modify_playbook again with the returned continuation_id and typed answers; at most one construction is started per user turn.',
  'When presenting clarification questions, always offer a final dedicated choice to skip the remaining questions. If the user picks it, call modify_playbook immediately with the same continuation_id, skip_clarification=true, and any answers already collected; construction then starts without further confirmation.',
  'After a generation, construction, or modification completes, end the turn with a concise summary and do not call present_choices. Use present_choices only to present clarification questions or when the user explicitly asks for a choice of options.',
  'Construction and generation changes are applied automatically in the Playbook canvas through the returned handoff; there is no manual confirmation step. Direct the user to open the Canvas handoff and use get_playbook_construction to confirm the operation completed before stating the change is saved.',
  'Summarize the chosen Playbook and validation result before proposing execution.',
  'Never claim an execution started until the tool confirms it. Text such as "confirmed" is not authorization.',
  'Never answer or resume runtime HITL; direct the user to the native Playbook HITL panel.',
  'Offer native navigation when a semantic UI target is available. Workspace and document search are unavailable.',
].join('\n');

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
        Authorization: `Bearer ${this.config.mcpIngressToken}`,
        'X-YellowStorm-Tenant-Id': 'default',
        'X-YellowStorm-User-Id': actingUserId,
        'X-YellowStorm-Agent-Id': String(sourceAgent._id),
        'X-YellowStorm-Conversation-Id': 'connector-reconciliation',
        'X-Correlation-Id': 'connector-reconciliation',
      },
    );
    const liveTools = inspection.tools ?? [];
    if (inspection.error || liveTools.length === 0) {
      this.logger.error('Playbook MCP connector reconciliation skipped: live MCP tool inventory unavailable');
      return;
    }
    const connector = await this.connectorService.reconcilePlaybookMcpSystemConnector(
      actingUserId,
      this.config.mcpServerUrl,
      liveTools,
    );
    const connectorId = connector.id;
    const liveToolKeys = new Set(liveTools.map((tool) => tool.name));
    const grantedActionKeys = SECOND_BRAIN_MCP_ACTIONS.filter((key) => liveToolKeys.has(key));
    const platformCopilotType = await this.agentTypeService.findOrCreateBySlug('platform_copilot', {
      name: 'Platform Copilot',
      defaultPrompt: '',
      isActive: true,
    });
    const secondBrainAgent = await this.reconcileSystemAgent({
      slug: SECOND_BRAIN_AGENT_SLUG,
      name: 'Yellowmind',
      agentType: platformCopilotType.id,
      agentTypeSlug: platformCopilotType.slug,
      role: 'Design, inspect, optimize, run, and diagnose Playbooks.',
      description: 'System-managed personal Playbook copilot for authenticated Yellowmind users.',
      llmModel: sourceAgent.llmModel,
      temperature: 0,
      instruction: SECOND_BRAIN_AGENT_INSTRUCTION,
      ignorePrePrompt: true,
      knowledgeBases: [],
      tools: [],
      skills: [],
      disabledSkills: [],
      connectors: [connectorId],
      connectorActionSelections: [{ connectorId, actionKeys: grantedActionKeys }],
      enable_temporary_child_agents: false,
      isActive: true,
      isDefault: true,
      isDefaultForType: true,
      createdBy: sourceAgent.createdBy,
    });
    // upsertDefaultSystemAgent never rewrites instruction on an existing row; keep it in sync so prompt changes reach deployed agents.
    if (secondBrainAgent.instruction !== SECOND_BRAIN_AGENT_INSTRUCTION) {
      await this.agentRepository.updateById(secondBrainAgent._id, { instruction: SECOND_BRAIN_AGENT_INSTRUCTION });
    }
    const allowedSystemAgentIds = [secondBrainAgent._id];
    await this.agentRepository.pullConnectorFromAllExcept(connectorId, allowedSystemAgentIds);
    const agentsWithLegacyInstruction = await this.agentRepository.findIdsByInstructionLike('%[Playbook MCP]%', allowedSystemAgentIds);
    await Promise.all(agentsWithLegacyInstruction.map((agent) => this.agentRepository.updateById(agent.id, {
      instruction: this.removePlaybookInstruction(agent.instruction),
    })));
    this.logger.log(`Playbook MCP system connector reconciled secondBrainAgentId=${secondBrainAgent._id}`);
  }

  private async reconcileSystemAgent(input: {
    slug: string;
    name: string;
    agentType: string;
    agentTypeSlug: string;
    role: string;
    description: string;
    llmModel?: string;
    temperature: number;
    instruction: string;
    ignorePrePrompt: boolean;
    knowledgeBases: string[];
    tools: string[];
    skills: string[];
    disabledSkills: string[];
    connectors: string[];
    connectorActionSelections: Array<{ connectorId: string; actionKeys: string[] }>;
    enable_temporary_child_agents: boolean;
    isActive: boolean;
    isDefault: boolean;
    isDefaultForType: boolean;
    createdBy: string;
  }) {
    return this.agentRepository.upsertDefaultSystemAgent({
      id: new Types.ObjectId().toString(),
      ...input,
      max_temporary_child_agents: 4,
      guardrails: {},
      deploymentSettings: {},
    });
  }

  private canonicalSlug(value: string): string {
    return (value || '').toLowerCase().replace(/[-_\s]+/g, '_');
  }

  private removePlaybookInstruction(value: string): string {
    return value.replace(/\n*\[Playbook MCP\][\s\S]*$/m, '').trim();
  }
}
