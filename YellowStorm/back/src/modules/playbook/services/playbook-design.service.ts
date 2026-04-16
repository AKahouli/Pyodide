import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PlaybookService } from './playbook.service';
import { PlaybookGrpcService } from './playbook-grpc.service';
import { PlaybookContextService } from './playbook-context.service';
import {
  PlaybookDesignMessage,
  PlaybookDesignMessageDocument,
} from '../schemas/playbook-design-message.schema';
import { PlaybookDesignMessageResponse } from '../interfaces/playbook.interface';
import { GeneratePlaybookDto } from '../dto/generate-playbook.dto';
import { DesignPlaybookDto } from '../dto/design-playbook.dto';
import { LoggerService } from '../../logger';
import { BadRequestException, ServiceUnavailableException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { AgentService } from '../../agent/agent.service';
import { ModelsService } from '../../models/models.service';
import { LiteLLMConnectionService } from '../../models/litellm-connection.service';
import { UsageService } from '../../usage/usage.service';
import { UsageType } from '../../usage/schemas/usage.schema';
import type { AxiosResponse } from 'axios';
import { PlaybookPromptService } from './playbook-prompt.service';

const FALLBACK_PROMPT_REWRITE_SYSTEM_PROMPT = [
  'You rewrite workflow prompts for a playbook builder.',
  'Improve clarity, specificity, structure, and actionability while preserving the user\'s intent.',
  'Return only the rewritten prompt as plain text, with no preamble, no bullets, and no quotes.',
].join(' ');

@Injectable()
export class PlaybookDesignService {
  constructor(
    @InjectModel(PlaybookDesignMessage.name)
    private readonly designMessageModel: Model<PlaybookDesignMessageDocument>,
    private readonly playbookService: PlaybookService,
    private readonly grpcService: PlaybookGrpcService,
    private readonly contextService: PlaybookContextService,
    private readonly promptService: PlaybookPromptService,
    private readonly agentService: AgentService,
    private readonly modelsService: ModelsService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly configService: ConfigService,
    private readonly usageService: UsageService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookDesignService');
  }

  private extractChatCompletionText(responseData: any): string | null {
    const content = responseData?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content.trim() || null;
    }

    if (Array.isArray(content)) {
      const text = content
        .map((item) => (typeof item?.text === 'string' ? item.text : ''))
        .join('\n')
        .trim();
      return text || null;
    }

    return null;
  }

  private normalizeRewritePrompt(text: string): string {
    return text
      .trim()
      .replace(/^```(?:text)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^(rewritten prompt|rewrite|prompt rewrite)\s*:\s*/i, '')
      .trim();
  }

  private async getPromptRewriteSystemPrompt(): Promise<string> {
    const prompt = await this.promptService.findByKey('design.prompt_rewrite');
    if (prompt?.enabled && prompt.systemTemplate?.trim()) {
      return prompt.systemTemplate.trim();
    }
    return this.configService.get<string>('playbook.promptRewriteSystemPrompt')?.trim() || FALLBACK_PROMPT_REWRITE_SYSTEM_PROMPT;
  }

  /**
   * Generate a playbook via the GeneratePlaybook gRPC RPC, then persist it.
   */
  async generatePlaybook(
    userId: string,
    dto: GeneratePlaybookDto,
    userEmail: string = '',
  ): Promise<{ id: string }> {
    this.logger.log('generatePlaybook called', { userId, prompt: dto.prompt.slice(0, 100) });

    if (!this.grpcService.isAvailable) {
      throw new ServiceUnavailableException(ErrorCode.PLAYBOOK_GRPC_UNAVAILABLE);
    }

    // Resolve all agents available to the user — fully built for gRPC
    const allAgents = await this.agentService.getAgentsForUser(userId);
    const allAgentIds = allAgents.map((a) => a.id);
    const defaultModel = await this.modelsService.getDefaultModel();
    const fallbackModelId = defaultModel?.id || '';
    const grpcAgents = await this.agentService.buildGrpcAgentsForPlaybook(userId, allAgentIds, fallbackModelId);
    await this.contextService.resolveAgentBrainContexts(grpcAgents);

    // Build workspace contexts
    const workspaceIds = (dto.workspaces || []).map((id) => id);
    const workspaceContexts = await this.contextService.buildWorkspaceContexts(workspaceIds);
    const promptOverrides = await this.promptService.getPromptOverridesPayload();

    const modelId = defaultModel?.id || defaultModel?.litellmModel || '';

    const grpcRequest = {
      query: dto.prompt,
      available_agents: grpcAgents,
      workspace_context: workspaceContexts,
      existing_playbook: null,
      model: modelId,
      prompt_overrides: promptOverrides,
    };

    this.logger.log('GeneratePlaybook gRPC request built', {
      agentCount: grpcAgents.length,
      workspaceCount: workspaceContexts.length,
      model: modelId,
    });

    try {
      const response = await this.grpcService.generatePlaybook(grpcRequest);

      const nodes: any[] = response.nodes || [];

      if (nodes.length === 0) {
        throw new BadRequestException(ErrorCode.PLAYBOOK_GENERATE_FAILED);
      }

      const { tasks, edges: playbookEdges } = this.mapGrpcResponseToTasksAndEdges(response);

      // Create the playbook in DB
      const playbook = await this.playbookService.createWithTasksAndEdges(
        userId,
        dto.name,
        dto.prompt,
        tasks,
        playbookEdges,
        dto.workspaces || [],
      );

      this.logger.log('Playbook generated and saved', {
        playbookId: playbook.id,
        taskCount: tasks.length,
        edgeCount: playbookEdges.length,
      });

      // Record usage from generation
      const usage = response.usage;
      if (usage) {
        this.usageService.recordUsage({
          userId,
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          usageType: UsageType.PLAYBOOK,
          modelName: usage.model || undefined,
          endpoint: 'playbook.generate',
        }).catch((err) => this.logger.warn('Failed to record generate usage', { error: (err as Error).message }));
      }

      return { id: playbook.id };
    } catch (error) {
      if ((error as any)?.errorCode) throw error; // Re-throw our own exceptions
      this.logger.error('GeneratePlaybook gRPC call failed', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw new ServiceUnavailableException(ErrorCode.PLAYBOOK_GENERATE_FAILED);
    }
  }

  async rewritePrompt(userId: string, prompt: string): Promise<{ prompt: string }> {
    const sourcePrompt = prompt.trim();
    this.logger.log('rewritePrompt called', { userId, prompt: sourcePrompt.slice(0, 100) });

    if (!sourcePrompt) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST);
    }

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    const systemPrompt = await this.getPromptRewriteSystemPrompt();
    const userPrompt = `<original_prompt>\n${sourcePrompt}\n</original_prompt>`;

    try {
      const response = await httpClient.post('/v1/chat/completions', {
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }, {
        timeout: 30000,
      });

      const rewrittenPrompt = this.normalizeRewritePrompt(this.extractChatCompletionText(response.data) || sourcePrompt);

      const usage = response.data?.usage;
      if (usage) {
        this.usageService.recordUsage({
          userId,
          inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
          outputTokens: usage.completion_tokens || usage.output_tokens || 0,
          usageType: UsageType.PLAYBOOK,
          modelName: usage.model || model,
          endpoint: 'playbook.rewrite-prompt',
        }).catch((err) => this.logger.warn('Failed to record rewrite usage', { error: (err as Error).message }));
      }

      return { prompt: rewrittenPrompt };
    } catch (error) {
      this.logger.error('Prompt rewrite failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }
  }

  async rewritePromptStream(
    userId: string,
    prompt: string,
    onChunk: (chunk: string) => void,
  ): Promise<{ prompt: string }> {
    const sourcePrompt = prompt.trim();
    this.logger.log('rewritePromptStream called', { userId, prompt: sourcePrompt.slice(0, 100) });

    if (!sourcePrompt) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST);
    }

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    const systemPrompt = await this.getPromptRewriteSystemPrompt();
    const userPrompt = `<original_prompt>\n${sourcePrompt}\n</original_prompt>`;

    let pending = '';
    let streamedText = '';

    try {
      const response = await httpClient.post('/v1/chat/completions', {
        model,
        temperature: 0.2,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }, {
        timeout: 30000,
        responseType: 'stream',
      }) as AxiosResponse;

      for await (const rawChunk of response.data as AsyncIterable<Buffer | string>) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk.toString('utf8') : String(rawChunk);
        pending += chunk;

        let separatorIndex = pending.indexOf('\n\n');
        while (separatorIndex !== -1) {
          const event = pending.slice(0, separatorIndex).trim();
          pending = pending.slice(separatorIndex + 2);

          const payload = event
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s*/, ''))
            .join('\n')
            .trim();

          if (payload && payload !== '[DONE]') {
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content;
              if (typeof delta === 'string' && delta) {
                streamedText += delta;
                onChunk(delta);
              }
            } catch {
              // Ignore malformed streaming chunks and continue.
            }
          }

          separatorIndex = pending.indexOf('\n\n');
        }
      }

      const result = this.normalizeRewritePrompt(streamedText || sourcePrompt);

      const usage = response.data?.usage;
      if (usage) {
        this.usageService.recordUsage({
          userId,
          inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
          outputTokens: usage.completion_tokens || usage.output_tokens || 0,
          usageType: UsageType.PLAYBOOK,
          modelName: usage.model || model,
          endpoint: 'playbook.rewrite-prompt',
        }).catch((err) => this.logger.warn('Failed to record rewrite usage', { error: (err as Error).message }));
      }

      return { prompt: result };
    } catch (error) {
      this.logger.error('Prompt rewrite stream failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }
  }

  async designPlaybook(
    userId: string,
    playbookId: string,
    dto: DesignPlaybookDto,
    userEmail: string = '',
  ): Promise<{ playbook: any; message: PlaybookDesignMessageResponse }> {
    this.logger.log('designPlaybook called', { userId, playbookId, query: dto.query.slice(0, 100) });

    if (!this.grpcService.isAvailable) {
      throw new ServiceUnavailableException(ErrorCode.PLAYBOOK_GRPC_UNAVAILABLE);
    }

    // Load current playbook
    const playbook = await this.playbookService.findById(playbookId);

    // Snapshot before state
    const snapshotBefore = {
      tasks: playbook.tasks.map((t) => ({ ...t })),
      edges: playbook.edges.map((e) => ({ ...e })),
    };

    // Resolve all agents available to the user — fully built for gRPC
    const allAgents = await this.agentService.getAgentsForUser(userId);
    const allAgentIds = allAgents.map((a) => a.id);
    const defaultModel = await this.modelsService.getDefaultModel();
    const fallbackModelId = defaultModel?.id || '';
    const grpcAgents = await this.agentService.buildGrpcAgentsForPlaybook(userId, allAgentIds, fallbackModelId);
    await this.contextService.resolveAgentBrainContexts(grpcAgents);

    // Build workspace contexts
    const workspaceContexts = await this.contextService.buildWorkspaceContexts(playbook.workspaces || []);
    const promptOverrides = await this.promptService.getPromptOverridesPayload();

    const modelId = defaultModel?.id || defaultModel?.litellmModel || '';

    const grpcRequest = {
      query: dto.query,
      available_agents: grpcAgents,
      workspace_context: workspaceContexts,
      existing_playbook: {
        nodes: playbook.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          assigned_agent_id: t.assignedAgentId || '',
          execution_order: t.executionOrder,
          x: t.positionX,
          y: t.positionY,
          interrupt_before: t.interruptBefore,
          interrupt_after: t.interruptAfter,
          allow_clarification: t.allowClarification,
          clarification_prompt: t.clarificationPrompt,
          max_clarifications: t.maxClarifications,
          input_keys: t.inputKeys,
          output_key: t.outputKey,
        })),
        edges: playbook.edges.map((e) => ({
          source_id: e.sourceId,
          target_id: e.targetId,
          source_output_port_id: e.sourceOutputPortId || 'default',
          target_input_port_id: e.targetInputPortId || 'default',
        })),
      },
      model: modelId,
      prompt_overrides: promptOverrides,
    };

    this.logger.log('Design gRPC request built', {
      playbookId,
      agentCount: grpcAgents.length,
      existingTaskCount: playbook.tasks.length,
    });

    try {
      const response = await this.grpcService.generatePlaybook(grpcRequest);

      const { tasks, edges } = this.mapGrpcResponseToTasksAndEdges(response);

      // Update playbook in DB
      const updatedPlaybook = await this.playbookService.update(playbookId, { tasks, edges });

      // Generate summary
      const aiSummary = this.generateDesignSummary(snapshotBefore.tasks, snapshotBefore.edges, tasks, edges);

      // Create design message
      const message = await this.designMessageModel.create({
        playbookId: new Types.ObjectId(playbookId),
        createdBy: new Types.ObjectId(userId),
        userQuery: dto.query,
        aiSummary,
        snapshotBefore,
        status: 'completed',
        error: null,
      });

      this.logger.log('Playbook designed successfully', {
        playbookId,
        messageId: message._id.toString(),
        aiSummary,
      });

      // Record usage
      const usage = response.usage;
      if (usage) {
        this.usageService.recordUsage({
          userId,
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          usageType: UsageType.PLAYBOOK,
          modelName: usage.model || undefined,
          endpoint: 'playbook.design',
        }).catch((err) => this.logger.warn('Failed to record design usage', { error: (err as Error).message }));
      }

      return {
        playbook: updatedPlaybook,
        message: this.mapDesignMessageToResponse(message),
      };
    } catch (error) {
      if ((error as any)?.errorCode) throw error;

      this.logger.error('Design gRPC call failed', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });

      // Save failed message so chat shows the error
      const message = await this.designMessageModel.create({
        playbookId: new Types.ObjectId(playbookId),
        createdBy: new Types.ObjectId(userId),
        userQuery: dto.query,
        aiSummary: '',
        snapshotBefore,
        status: 'failed',
        error: (error as Error).message || 'Design failed',
      });

      return {
        playbook: null,
        message: this.mapDesignMessageToResponse(message),
      };
    }
  }

  private mapGrpcResponseToTasksAndEdges(response: any): { tasks: any[]; edges: any[] } {
    const nodes: any[] = response.nodes || [];
    const grpcEdges: any[] = response.edges || [];

    const tasks = nodes.map((node: any, idx: number) => ({
      id: node.id || `task-${idx}`,
      title: node.title || `Step ${idx + 1}`,
      description: node.description || '',
      assignedAgentId: this.toOptionalObjectId(node.assigned_agent_id),
      executionOrder: node.execution_order ?? idx,
      positionX: node.x ?? 0,
      positionY: node.y ?? 0,
      interruptBefore: node.interrupt_before || false,
      interruptAfter: node.interrupt_after || false,
      allowClarification: node.allow_clarification || false,
      clarificationPrompt: node.clarification_prompt || '',
      maxClarifications: node.max_clarifications || 3,
      inputKeys: node.input_keys || [],
      outputKey: node.output_key || '',
      taskType: node.task_type || 'generic',
      inputPorts:
        (node.input_ports || []).length > 0
          ? node.input_ports.map((p: any) => ({
              id: p.id || `in-${idx}`,
              name: p.name || 'Input',
              artifactKind: p.artifact_kind || 'text',
              required: p.required ?? false,
              description: p.description || '',
            }))
          : [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
      outputPorts:
        (node.output_ports || []).length > 0
          ? node.output_ports.map((p: any) => ({
              id: p.id || `out-${idx}`,
              name: p.name || 'Output',
              artifactKind: p.artifact_kind || 'text',
              description: p.description || '',
            }))
          : [{ id: 'default', name: 'Output', artifactKind: 'text' }],
    }));

    const edges = grpcEdges.map((edge: any, idx: number) => ({
      id: `edge-${idx}`,
      sourceId: edge.source_id,
      targetId: edge.target_id,
      sourceOutputPortId: edge.source_output_port_id || 'default',
      targetInputPortId: edge.target_input_port_id || 'default',
    }));

    return { tasks, edges };
  }

  private toOptionalObjectId(value: unknown): Types.ObjectId | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const candidate = String(value);
    return Types.ObjectId.isValid(candidate) ? new Types.ObjectId(candidate) : null;
  }

  private generateDesignSummary(
    oldTasks: any[],
    oldEdges: any[],
    newTasks: any[],
    newEdges: any[],
  ): string {
    const oldTaskIds = new Set(oldTasks.map((t) => t.id));
    const newTaskIds = new Set(newTasks.map((t) => t.id));

    const added = newTasks.filter((t) => !oldTaskIds.has(t.id)).length;
    const removed = oldTasks.filter((t) => !newTaskIds.has(t.id)).length;

    const oldTaskMap = new Map(oldTasks.map((t) => [t.id, t]));
    let modified = 0;
    for (const nt of newTasks) {
      const ot = oldTaskMap.get(nt.id);
      if (ot && (ot.title !== nt.title || ot.description !== nt.description)) {
        modified++;
      }
    }

    const oldEdgeKeys = new Set(oldEdges.map((e) => this.buildEdgeKey(e)));
    const newEdgeKeys = new Set(newEdges.map((e) => this.buildEdgeKey(e)));
    const edgesAdded = [...newEdgeKeys].filter((k) => !oldEdgeKeys.has(k)).length;
    const edgesRemoved = [...oldEdgeKeys].filter((k) => !newEdgeKeys.has(k)).length;

    const parts: string[] = [];
    if (added > 0) parts.push(`Added ${added} step${added > 1 ? 's' : ''}`);
    if (removed > 0) parts.push(`Removed ${removed} step${removed > 1 ? 's' : ''}`);
    if (modified > 0) parts.push(`Modified ${modified} step${modified > 1 ? 's' : ''}`);
    if (edgesAdded > 0) parts.push(`Added ${edgesAdded} connection${edgesAdded > 1 ? 's' : ''}`);
    if (edgesRemoved > 0) parts.push(`Removed ${edgesRemoved} connection${edgesRemoved > 1 ? 's' : ''}`);

    return parts.length > 0 ? parts.join(', ') : 'No structural changes';
  }

  private mapDesignMessageToResponse(message: any): PlaybookDesignMessageResponse {
    return {
      id: (message._id || message.id).toString(),
      playbookId: message.playbookId.toString(),
      userQuery: message.userQuery,
      aiSummary: message.aiSummary || '',
      snapshotBefore: message.snapshotBefore || { tasks: [], edges: [] },
      status: message.status,
      revertedFromMessageId: message.revertedFromMessageId?.toString() || null,
      error: message.error || null,
      createdAt: message.createdAt?.toISOString?.() || message.createdAt,
      updatedAt: message.updatedAt?.toISOString?.() || message.updatedAt,
    };
  }

  private buildEdgeKey(edge: any): string {
    const sourceId = edge.sourceId ?? edge.source_id ?? '';
    const targetId = edge.targetId ?? edge.target_id ?? '';
    const sourcePortId = edge.sourceOutputPortId ?? edge.source_output_port_id ?? 'default';
    const targetPortId = edge.targetInputPortId ?? edge.target_input_port_id ?? 'default';
    return `${sourceId}:${sourcePortId}->${targetId}:${targetPortId}`;
  }
}
