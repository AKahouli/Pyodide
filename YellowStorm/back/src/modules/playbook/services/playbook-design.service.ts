import { Injectable } from '@nestjs/common';
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
import { UsageService } from '../../usage/usage.service';
import { UsageType } from '../../usage/schemas/usage.schema';

@Injectable()
export class PlaybookDesignService {
  constructor(
    @InjectModel(PlaybookDesignMessage.name)
    private readonly designMessageModel: Model<PlaybookDesignMessageDocument>,
    private readonly playbookService: PlaybookService,
    private readonly grpcService: PlaybookGrpcService,
    private readonly contextService: PlaybookContextService,
    private readonly agentService: AgentService,
    private readonly modelsService: ModelsService,
    private readonly usageService: UsageService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookDesignService');
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

    const modelId = defaultModel?.litellmModel || defaultModel?.id || '';

    const grpcRequest = {
      query: dto.prompt,
      available_agents: grpcAgents,
      workspace_context: workspaceContexts,
      existing_playbook: null,
      model: modelId,
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

    const modelId = defaultModel?.litellmModel || defaultModel?.id || '';

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
        })),
      },
      model: modelId,
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
      assignedAgentId: node.assigned_agent_id
        ? new Types.ObjectId(node.assigned_agent_id)
        : null,
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
    }));

    const edges = grpcEdges.map((edge: any, idx: number) => ({
      id: `edge-${idx}`,
      sourceId: edge.source_id,
      targetId: edge.target_id,
    }));

    return { tasks, edges };
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

    const oldEdgeKeys = new Set(oldEdges.map((e) => `${e.sourceId}-${e.targetId}`));
    const newEdgeKeys = new Set(newEdges.map((e) => `${e.sourceId}-${e.targetId}`));
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
}
