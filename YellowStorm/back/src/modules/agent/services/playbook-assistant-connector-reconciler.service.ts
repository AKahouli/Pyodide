import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Types } from 'mongoose';
import playbookFlowConfig from '@config/playbook-flow.config';
import { ConnectorService } from '@modules/connector/connector.service';
import { AgentTypeService } from '@modules/agent-type/agent-type.service';
import { AgentRepository } from '../repositories/agent.repository';

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
    const connectorId = connector.id;
    const assistantType = await this.agentTypeService.findOrCreateBySlug('playbook_assistant', {
      name: 'Playbook Assistant',
      defaultPrompt: '',
      isActive: true,
    });
    const assistantFields = {
      name: 'Playbook AI Workflow Assistant',
      slug: PLAYBOOK_ASSISTANT_AGENT_SLUG,
      agentType: assistantType.id,
      agentTypeSlug: assistantType.slug,
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
      connectorActionSelections: [{ connectorId, actionKeys: [...PLAYBOOK_MCP_ACTIONS] }],
      enable_temporary_child_agents: false,
      isActive: true,
      isDefault: true,
      isDefaultForType: true,
    };
    const existingDedicated = await this.agentRepository.findBySlug({ slug: PLAYBOOK_ASSISTANT_AGENT_SLUG, isDefault: true });
    let dedicatedAgentId: string;
    if (existingDedicated) {
      await this.agentRepository.updateById(existingDedicated._id, assistantFields);
      dedicatedAgentId = existingDedicated._id;
    } else {
      dedicatedAgentId = new Types.ObjectId().toString();
      await this.agentRepository.create({
        id: dedicatedAgentId,
        ...assistantFields,
        guardrails: {},
        deploymentSettings: {},
        max_temporary_child_agents: 4,
        createdBy: sourceAgent.createdBy,
      });
    }
    await this.agentRepository.pullConnectorFromAllExcept(connectorId, dedicatedAgentId);
    const agentsWithLegacyInstruction = await this.agentRepository.findIdsByInstructionLike('%[Playbook MCP]%', dedicatedAgentId);
    for (const agent of agentsWithLegacyInstruction) {
      await this.agentRepository.updateById(agent.id, { instruction: this.removePlaybookInstruction(agent.instruction ?? '') });
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
