import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FlowExecution,
  FlowExecutionDocument,
} from '../../schemas/playbook-flow-execution.schema';
import { FlowHitlMemory, FlowHitlMemoryDocument } from '../../schemas/playbook-flow-hitl-memory.schema';
import { NotFoundException, BadRequestException, ConflictException, ServiceUnavailableException } from '../../../exceptions';
import { ErrorCode } from '../../../exceptions/constants/error-codes';
import {
  IFlowExecutionResponse,
  IResumeApprovalPayload,
  IResumeFromStepPayload,
} from '../../interfaces/playbook-flow-execution.interface';
import { PlaybookFlowStreamEventsService } from '../playbook-flow-stream-events.service';
import { PlaybookFlowReplayBaselineService } from '../playbook-flow-replay-baseline.service';
import type { ResolvedReplayArtifacts } from '../../interfaces/playbook-flow-replay-artifact.interface';
import { LoggerService } from '../../../logger';
import { toGrpcStruct } from '../../execution/grpc/grpc-struct.mapper';

interface RuntimeHitlMemory {
  id: string;
  node_id: string | null;
  memory_type: string;
  title: string;
  normalized_instruction: string;
  content: string;
  applies_to: string;
  sensitivity: string;
}

interface FutureHitlMemoryParams {
  executionId: string;
  ownerId: string;
  flowId: string;
  taskId: string;
  interruptId: string;
  interruptType?: string;
  taskTitle?: string;
  response: {
    action: string;
    message?: string | null;
    feedback?: string | null;
    reason?: string | null;
    scope: string;
    remember: boolean;
  };
  riskLevel?: string;
}

@Injectable()
export class PlaybookHitlApprovalService {
  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    private readonly replayBaselineService: PlaybookFlowReplayBaselineService,
    private readonly logger: LoggerService,
    @InjectModel(FlowHitlMemory.name)
    private readonly hitlMemoryModel?: Model<FlowHitlMemoryDocument>,
  ) {
    this.logger.setContext(PlaybookHitlApprovalService.name);
  }

  mapRuntimeHitlMemories(memories: Array<Record<string, unknown>>): RuntimeHitlMemory[] {
    return memories.map((memory) => ({
      id: String(memory.id || memory._id || ''),
      node_id: memory.nodeId == null ? null : String(memory.nodeId),
      memory_type: String(memory.memoryType || 'procedural'),
      title: String(memory.title || ''),
      normalized_instruction: String(memory.normalizedInstruction || memory.content || ''),
      content: String(memory.content || ''),
      applies_to: String(memory.appliesTo || 'workflow'),
      sensitivity: String(memory.sensitivity || 'normal'),
    }));
  }

  async loadActiveHitlMemories(
    flowId: string,
    taskIds: string[],
  ): Promise<RuntimeHitlMemory[]> {
    if (!this.hitlMemoryModel) {
      return [];
    }

    const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));
    const memories = await this.hitlMemoryModel.find({
      flowId,
      status: 'active',
      $or: [
        { nodeId: null },
        { nodeId: { $exists: false } },
        ...(uniqueTaskIds.length > 0 ? [{ nodeId: { $in: uniqueTaskIds } }] : []),
      ],
    }).lean().exec() as Array<Record<string, unknown>>;

    return this.mapRuntimeHitlMemories(memories);
  }

  buildRuntimeInputContext(
    inputContext: Record<string, unknown>,
    activeHitlMemories: RuntimeHitlMemory[],
  ): Record<string, unknown> {
    const { __playbook_hitl_memory: _ignoredHitlMemory, ...safeInputContext } = inputContext;
    return {
      ...safeInputContext,
      __playbook_hitl_memory: activeHitlMemories,
    };
  }

  buildCurrentHitlContextFingerprints(params: {
    artifacts: ResolvedReplayArtifacts;
    inputContext: Record<string, unknown>;
    nodeSnapshot: Record<string, unknown>;
  }): Record<string, string> {
    const result: Record<string, string> = {};
    for (const snapshot of params.artifacts.hitlMemorySnapshots ?? []) {
      result[snapshot.interruptId] = this.replayBaselineService.buildHitlContextFingerprint({
        inputContext: params.inputContext,
        nodeSnapshot: params.nodeSnapshot,
        reasonCode: snapshot.reasonCode,
        prompt: snapshot.prompt,
        downstreamNodeIds: snapshot.downstreamNodeIds,
      });
    }
    return result;
  }

  async createFutureHitlMemoryIfRequested(params: FutureHitlMemoryParams): Promise<void> {
    if (!this.hitlMemoryModel || !params.response.remember) {
      return;
    }
    if (params.response.scope !== 'future_node_runs' && params.response.scope !== 'future_workflow_runs') {
      return;
    }

    const content = params.response.feedback || params.response.message || params.response.reason || '';
    if (!content.trim()) {
      return;
    }

    await this.hitlMemoryModel.create({
      ownerId: params.ownerId,
      flowId: params.flowId,
      nodeId: params.response.scope === 'future_node_runs' ? params.taskId : null,
      memoryType: params.interruptType === 'approval_request' ? 'approval_policy' : 'procedural',
      source: 'hitl_feedback',
      title: this.buildHitlMemoryTitle(params.taskTitle, params.response.scope),
      content,
      normalizedInstruction: content,
      appliesTo: params.response.scope === 'future_node_runs' ? 'node' : 'workflow',
      status: 'active',
      sensitivity: params.interruptType === 'approval_request' || params.riskLevel === 'high' || params.riskLevel === 'critical'
        ? 'sensitive'
        : 'normal',
      createdFromExecutionId: params.executionId,
      createdFromInterruptId: params.interruptId || undefined,
    });
    this.streamEvents.emitHitlMemorySaved(params.executionId, {
      taskId: params.taskId,
      scope: params.response.scope,
      interruptId: params.interruptId,
    });
  }

  private buildHitlMemoryTitle(taskTitle: string | undefined, scope: string): string {
    const target = taskTitle?.trim() || 'workflow step';
    return scope === 'future_node_runs'
      ? `HITL guidance for ${target}`
      : 'Workflow HITL guidance';
  }
}
