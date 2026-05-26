import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { AgentService } from '@modules/agent/agent.service';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';
import { UsageService } from '@modules/usage/usage.service';
import { UsageType } from '@modules/usage/schemas/usage.schema';
import { PlaybookFlowDesignGrpcService } from './playbook-flow-design-grpc.service';
import { PlaybookFlowService } from './playbook-flow.service';
import { PlaybookFlowContextService } from './playbook-flow-context.service';
import { PlaybookFlowSettingsService } from './playbook-flow-settings.service';
import { PlaybookFlowPromptTemplateService } from './playbook-flow-prompt-template.service';
import { FlowDesignMessage, FlowDesignMessageDocument } from '../schemas/playbook-flow-design-message.schema';
import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { mapGrpcResponseToFlow } from './playbook-flow-design-mapper';

const FALLBACK_PROMPT_REWRITE_SYSTEM_PROMPT = [
  'You rewrite workflow prompts for a playbook builder.',
  'Improve clarity, specificity, structure, and actionability while preserving intent.',
  'Return only the rewritten prompt as plain text.',
].join(' ');

@Injectable()
export class PlaybookFlowDesignService {
  constructor(
    @InjectModel(FlowDesignMessage.name)
    private readonly designMessageModel: Model<FlowDesignMessageDocument>,
    private readonly playbookFlowService: PlaybookFlowService,
    private readonly grpcService: PlaybookFlowDesignGrpcService,
    private readonly contextService: PlaybookFlowContextService,
    private readonly promptService: PlaybookFlowPromptTemplateService,
    private readonly agentService: AgentService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly settingsService: PlaybookFlowSettingsService,
    private readonly usageService: UsageService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowDesignService'); }

  async generateFlow(
    userId: string, name: string, prompt: string, workspaceIds: string[] = [],
  ): Promise<{ id: string }> {
    if (!this.grpcService.isAvailable) throw new ServiceUnavailableException(ErrorCode.PLAYBOOK_GRPC_UNAVAILABLE);

    const allAgents = await this.agentService.getAgentsForUser(userId);
    const modelId = await this.settingsService.resolveInferenceModel() || '';
    const grpcAgents = await this.agentService.buildGrpcAgentsForPlaybook(userId, allAgents.map((a) => a.id), modelId);
    await this.contextService.resolveAgentBrainContexts(grpcAgents);

    const workspaceContexts = await this.contextService.buildWorkspaceContexts(workspaceIds);
    const promptOverrides = await this.promptService.getPromptOverridesPayload();

    const response = await this.grpcService.generatePlaybook({
      user_context: { user_id: userId, username: userId },
      query: prompt, available_agents: grpcAgents,
      workspace_context: workspaceContexts, existing_playbook: null,
      model: modelId, prompt_overrides: promptOverrides,
    });

    const { nodes, controlEdges, dataBindings } = mapGrpcResponseToFlow(response);
    if (!nodes.length) throw new BadRequestException(ErrorCode.PLAYBOOK_GENERATE_FAILED);

    const flow = await this.playbookFlowService.createWithNodesAndEdges(
      userId, name, prompt, nodes, controlEdges, dataBindings, workspaceIds,
    );

    const usage = response.usage;
    if (usage) {
      this.usageService.recordUsage({
        userId, inputTokens: usage.input_tokens || 0, outputTokens: usage.output_tokens || 0,
        usageType: UsageType.PLAYBOOK, modelName: usage.model || undefined, endpoint: 'flow.generate',
      }).catch((err) => this.logger.warn('Usage record failed', { error: (err as Error).message }));
    }
    return { id: flow.id };
  }

  async designFlow(userId: string, flowId: string, query: string): Promise<any> {
    if (!this.grpcService.isAvailable) throw new ServiceUnavailableException(ErrorCode.PLAYBOOK_GRPC_UNAVAILABLE);

    const flow = await this.playbookFlowService.findById(flowId);
    const snapshotBefore = {
      nodes: (flow.nodes || []).map((n: any) => ({ ...n })),
      controlEdges: (flow.controlEdges || []).map((e: any) => ({ ...e })),
      dataBindings: (flow.dataBindings || []).map((b: any) => ({ ...b })),
    };

    const allAgents = await this.agentService.getAgentsForUser(userId);
    const modelId = await this.settingsService.resolveInferenceModel(flow.designSettings) || '';
    const grpcAgents = await this.agentService.buildGrpcAgentsForPlaybook(userId, allAgents.map((a) => a.id), modelId);
    await this.contextService.resolveAgentBrainContexts(grpcAgents);

    const workspaceContexts = await this.contextService.buildWorkspaceContexts(flow.workspaces || []);
    const promptOverrides = await this.promptService.getPromptOverridesPayload();

    try {
      const response = await this.grpcService.generatePlaybook({
        user_context: { user_id: userId, username: userId },
        query, available_agents: grpcAgents,
        workspace_context: workspaceContexts,
        existing_playbook: {
          nodes: (flow.nodes || []).map((n: any) => ({
            id: n.id,
            title: n.label || n.id,
            description: n.description || n.metadata?.description || '',
            assigned_agent_id: n.metadata?.assignedAgentId || '', execution_order: 0,
          })),
          edges: (flow.controlEdges || []).map((e: any) => ({
            source_id: e.source, target_id: e.target,
            source_output_port_id: e.sourceOutputPortId || e.routerLabel || 'default',
            target_input_port_id: e.targetInputPortId || 'default',
          })),
        },
        model: modelId, prompt_overrides: promptOverrides,
      });

      const { nodes, controlEdges, dataBindings } = mapGrpcResponseToFlow(response);
      const updatedFlow = await this.playbookFlowService.updateNodesAndEdges(flowId, {
        nodes,
        controlEdges,
        dataBindings: dataBindings.length > 0 ? dataBindings : snapshotBefore.dataBindings,
      });

      const aiSummary = this.generateDesignSummary(
        snapshotBefore.nodes, snapshotBefore.controlEdges, nodes, controlEdges,
      );

      const message = await this.designMessageModel.create({
        flowId: new Types.ObjectId(flowId), createdBy: new Types.ObjectId(userId),
        userQuery: query, aiSummary, snapshotBefore,
        status: 'completed', error: null,
      });

      return { flow: updatedFlow, message: this.mapMessageToResponse(message) };
    } catch (error) {
      if ((error as any)?.errorCode) throw error;
      const message = await this.designMessageModel.create({
        flowId: new Types.ObjectId(flowId), createdBy: new Types.ObjectId(userId),
        userQuery: query, aiSummary: '', snapshotBefore,
        status: 'failed', error: (error as Error).message || 'Design failed',
      });
      return { flow: null, message: this.mapMessageToResponse(message) };
    }
  }

  async rewritePrompt(userId: string, prompt: string): Promise<{ prompt: string }> {
    if (!prompt.trim()) throw new BadRequestException(ErrorCode.BAD_REQUEST);
    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    const model = await this.settingsService.resolveInferenceModel();
    if (!model) throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);

    const sysPrompt = await this.getRewriteSystemPrompt();
    const response = await httpClient.post('/v1/chat/completions', {
      model, temperature: 0.2,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: `<original_prompt>\n${prompt.trim()}\n</original_prompt>` },
      ],
    }, { timeout: 360000 });

    const content = response.data?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content.trim() : prompt.trim();
    return { prompt: this.normalizeRewritePrompt(text) };
  }

  private async getRewriteSystemPrompt(): Promise<string> {
    const prompt = await this.promptService.findByKey('design.prompt_rewrite');
    return prompt?.enabled && prompt.systemTemplate?.trim()
      ? prompt.systemTemplate.trim() : FALLBACK_PROMPT_REWRITE_SYSTEM_PROMPT;
  }

  private normalizeRewritePrompt(text: string): string {
    return text.replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '')
      .replace(/^(rewritten prompt|rewrite|prompt rewrite)\s*:\s*/i, '').trim();
  }

  private generateDesignSummary(
    oldNodes: any[], oldEdges: any[], newNodes: any[], newEdges: any[],
  ): string {
    const oldIds = new Set(oldNodes.map((n) => n.id));
    const newIds = new Set(newNodes.map((n) => n.id));
    const added = newNodes.filter((n) => !oldIds.has(n.id)).length;
    const removed = oldNodes.filter((n) => !newIds.has(n.id)).length;
    const parts: string[] = [];
    if (added > 0) parts.push(`Added ${added} node${added > 1 ? 's' : ''}`);
    if (removed > 0) parts.push(`Removed ${removed} node${removed > 1 ? 's' : ''}`);
    const oldEdgeKeys = new Set(oldEdges.map((e) => `${e.source}->${e.target}`));
    const newEdgeKeys = new Set(newEdges.map((e) => `${e.source}->${e.target}`));
    const edgesAdded = [...newEdgeKeys].filter((k) => !oldEdgeKeys.has(k)).length;
    const edgesRemoved = [...oldEdgeKeys].filter((k) => !newEdgeKeys.has(k)).length;
    if (edgesAdded > 0) parts.push(`Added ${edgesAdded} connection${edgesAdded > 1 ? 's' : ''}`);
    if (edgesRemoved > 0) parts.push(`Removed ${edgesRemoved} connection${edgesRemoved > 1 ? 's' : ''}`);
    return parts.length > 0 ? parts.join(', ') : 'No structural changes';
  }

  async getDesignMessages(flowId: string, userId: string): Promise<any[]> {
    const flow = await this.playbookFlowService.findById(flowId);
    if (String(flow.ownerId) !== String(userId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN);
    }
    const messages = await this.designMessageModel
      .find({ flowId: new Types.ObjectId(flowId) })
      .sort({ createdAt: -1 })
      .lean();
    return messages.map((m) => this.mapMessageToResponse(m));
  }

  async revertToSnapshot(flowId: string, msgId: string, userId: string) {
    const flow = await this.playbookFlowService.findById(flowId);
    if (String(flow.ownerId) !== String(userId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN);
    }

    if (!Types.ObjectId.isValid(msgId)) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Invalid message ID');
    }

    const message = await this.designMessageModel.findById(msgId);
    if (!message || String(message.flowId) !== String(flowId)) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Design message not found');
    }

    const snapshot = message.snapshotBefore;
    const updatedFlow = await this.playbookFlowService.updateNodesAndEdges(flowId, {
      nodes: snapshot.nodes || [],
      controlEdges: snapshot.controlEdges || [],
      dataBindings: snapshot.dataBindings || [],
    });

    const revertedMessage = await this.designMessageModel.create({
      flowId: new Types.ObjectId(flowId),
      createdBy: new Types.ObjectId(userId),
      userQuery: `Reverted to snapshot from ${msgId}`,
      aiSummary: 'Flow reverted to previous design snapshot',
      snapshotBefore: {
        nodes: (flow.nodes || []).map((n: any) => ({ ...n })),
        controlEdges: (flow.controlEdges || []).map((e: any) => ({ ...e })),
        dataBindings: (flow.dataBindings || []).map((b: any) => ({ ...b })),
      },
      status: 'reverted',
      revertedFromMessageId: message._id,
    });

    return { flow: updatedFlow, message: this.mapMessageToResponse(revertedMessage) };
  }

  private mapMessageToResponse(message: any) {
    return {
      id: (message._id || message.id).toString(),
      flowId: message.flowId?.toString?.() || message.flowId,
      userQuery: message.userQuery,
      aiSummary: message.aiSummary || '',
      status: message.status,
      error: message.error || null,
      createdAt: message.createdAt?.toISOString?.() || message.createdAt,
      updatedAt: message.updatedAt?.toISOString?.() || message.updatedAt,
    };
  }
}
