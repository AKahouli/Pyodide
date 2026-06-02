import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../schemas/playbook-flow-task-result.schema';
import { FlowRouterDecision, FlowRouterDecisionDocument } from '../schemas/playbook-flow-router-decision.schema';
import {
  FlowValidatedReplay,
  FlowValidatedReplayDocument,
  FlowReplayValidationStatus,
  type ReplayMode,
} from '../schemas/playbook-flow-validated-replay.schema';
import { flattenUsage } from './observability/playbook-flow-observability.mapper';
import { PlaybookFlowReplayBaselineService } from './playbook-flow-replay-baseline.service';

export interface TraceReplayEvent {
  type: 'NodeStarted' | 'NodeCompleted' | 'NodeFailed' | 'RouterDecision' | 'ApprovalRequested' | 'ExecutionCompleted' | 'ExecutionFailed';
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ValidateTaskReplayOptions {
  preserveOutputFormat?: boolean;
  mode?: ReplayMode | 'strict_replay';
  replayConfig?: {
    replayOutputFormat?: boolean;
    replayToolTrace?: boolean;
    replayReasoningChain?: boolean;
  };
}

export interface UpdateReplayFormatGuidePayload {
  preserveOutputFormat?: boolean;
  outputFormatGuide?: string;
  replayConfig?: {
    replayOutputFormat?: boolean;
    replayToolTrace?: boolean;
    replayReasoningChain?: boolean;
  };
}

@Injectable()
export class PlaybookFlowReplayService {
  constructor(
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name) private readonly taskResultModel: Model<FlowTaskResultDocument>,
    @InjectModel(FlowRouterDecision.name) private readonly routerDecisionModel: Model<FlowRouterDecisionDocument>,
    @InjectModel(FlowValidatedReplay.name) private readonly replayModel: Model<FlowValidatedReplayDocument>,
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly replayBaselineService: PlaybookFlowReplayBaselineService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowReplayService'); }

  async traceReplay(executionId: string, userId: string): Promise<TraceReplayEvent[]> {
    const execution = await this.executionModel.findOne({ _id: executionId, ownerId: userId }).select('+snapshot +inputContext').lean();
    if (!execution) throw new NotFoundException('Execution not found');

    const [taskResults, routerDecisions] = await Promise.all([
      this.taskResultModel.find({ executionId }).sort({ endedAt: 1 }).lean(),
      this.routerDecisionModel.find({ executionId }).sort({ decidedAt: 1 }).lean(),
    ]);

    const events: TraceReplayEvent[] = [];

    for (const tr of taskResults) {
      const ts = tr.startedAt?.toISOString() ?? (tr as any).createdAt?.toISOString() ?? '';
      const te = tr.endedAt?.toISOString() ?? ts;

      events.push({
        type: 'NodeStarted',
        timestamp: ts,
        data: { taskId: tr.taskId, iteration: tr.iteration },
      });

      if (tr.status === 'completed') {
        const usage = tr.usage ?? null;
        events.push({
          type: 'NodeCompleted',
          timestamp: te,
          data: {
            taskId: tr.taskId,
            iteration: tr.iteration,
            output: tr.output,
            displayText: tr.displayText,
            toolTrace: tr.toolTrace ?? [],
            reasoningChain: (tr as any).reasoningChain ?? [],
            llmPromptTrace: tr.llmPromptTrace ?? [],
            usage,
            ...flattenUsage({ usage }),
            semanticMatch: tr.semanticMatch ?? null,
            traceMetadata: tr.traceMetadata ?? {},
          },
        });
      } else if (tr.status === 'failed') {
        events.push({
          type: 'NodeFailed',
          timestamp: te,
          data: { taskId: tr.taskId, iteration: tr.iteration, error: tr.error },
        });
      }
    }

    for (const rd of routerDecisions) {
      events.push({
        type: 'RouterDecision',
        timestamp: rd.decidedAt?.toISOString() ?? (rd as any).createdAt?.toISOString() ?? '',
        data: { routerNodeId: rd.routerNodeId, iteration: rd.iteration, label: rd.label },
      });
    }

    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const finalEvent: TraceReplayEvent = {
      type: execution.status === 'completed' ? 'ExecutionCompleted' : 'ExecutionFailed',
      timestamp: execution.endedAt?.toISOString() ?? new Date().toISOString(),
      data: { status: execution.status, error: execution.error },
    };
    events.push(finalEvent);

    return events;
  }

  async reExecute(executionId: string, userId: string): Promise<{ executionId: string; divergenceWarning: boolean }> {
    const execution = await this.executionModel.findOne({ _id: executionId, ownerId: userId }).select('+snapshot +inputContext').lean();
    if (!execution) throw new NotFoundException('Execution not found');

    const result = await this.executionService.start(
      execution.flowId,
      userId,
      execution.inputContext as Record<string, unknown> | undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      execution.executionMode || 'live',
      execution.stepExecutionModes as Record<string, string> | undefined,
      execution.modelIdOverride,
    );

    return { executionId: result.id, divergenceWarning: true };
  }

  async validateTaskReplay(
    userId: string,
    flowId: string,
    taskId: string,
    iteration: number,
    executionId: string,
    dto?: ValidateTaskReplayOptions,
  ): Promise<FlowValidatedReplayDocument> {
    const execution = await this.executionModel.findOne({ _id: executionId, ownerId: userId }).select('+snapshot +inputContext').lean();
    if (!execution) throw new NotFoundException('Execution not found');
    if (execution.flowId !== flowId) throw new NotFoundException('Execution not found');

    const taskResult = await this.taskResultModel.findOne({ executionId, taskId, iteration }).lean();
    if (!taskResult) throw new NotFoundException('Task result not found');

    const referenceNodeSnapshot = this.findReferenceNodeSnapshot(execution.snapshot, taskId);
    if (!referenceNodeSnapshot) throw new NotFoundException('Task not found in execution snapshot');

    const lastReplay = await this.replayModel
      .findOne({ flowId, taskId })
      .sort({ validationVersion: -1 })
      .lean();

    const newVersion = (lastReplay?.validationVersion ?? 0) + 1;
    const taskTitle = this.resolveTaskTitle(referenceNodeSnapshot, taskId);
    const taskDescription = this.resolveTaskDescription(referenceNodeSnapshot);
    const referenceExecutionNumber = this.resolveReferenceExecutionNumber(execution);
    const baseline = this.replayBaselineService.buildValidatedReplayBaseline({
      taskId,
      iteration,
      taskTitle,
      taskDescription,
      referenceExecutionId: executionId,
      referenceExecutionNumber,
      mode: dto?.mode,
      inputContext: execution.inputContext,
      flowSnapshot: execution.snapshot,
      nodeSnapshot: referenceNodeSnapshot,
      taskResult: {
        output: taskResult.output,
        toolTrace: taskResult.toolTrace ?? [],
        reasoningChain: (taskResult as any).reasoningChain ?? [],
        judgeResult: taskResult.judgeResult ?? null,
      },
      hitlEvents: execution.hitlEvents ?? [],
      preserveOutputFormat: dto?.preserveOutputFormat ?? false,
      outputFormatGuide: undefined,
    });

    const [replay] = await this.replayModel.create([{
      flowId,
      taskId,
      iteration,
      taskTitle,
      referenceTaskDescription: taskDescription ?? '',
      createdBy: userId,
      referenceExecutionId: executionId,
      referenceExecutionNumber,
      validationVersion: newVersion,
      status: FlowReplayValidationStatus.ACTIVE,
      mode: baseline.mode,
      referenceOutput: typeof taskResult.output === 'string' ? taskResult.output : JSON.stringify(taskResult.output ?? ''),
      toolCalls: taskResult.toolTrace ?? [],
      reasoningChain: (taskResult as any).reasoningChain ?? [],
      llmPromptTrace: taskResult.llmPromptTrace ?? [],
      fingerprints: baseline.fingerprints,
      behaviorBaseline: baseline.behaviorBaseline,
      toolPolicy: baseline.toolPolicy,
      outputContract: baseline.outputContract,
      intentKey: baseline.intentKey,
      intentLabel: baseline.intentLabel,
      reasoningOutline: baseline.reasoningOutline,
      stableReasoningRules: baseline.stableReasoningRules,
      contextVariableSchema: baseline.contextVariableSchema,
      toolTraceTemplate: baseline.toolTraceTemplate,
      semanticChecklist: baseline.semanticChecklist,
      hitlMemorySnapshots: baseline.hitlMemorySnapshots,
      driftPolicy: baseline.driftPolicy,
      acceptedExamples: baseline.acceptedExamples,
      referenceUsage: taskResult.usage ?? null,
      referenceSemanticMatch: taskResult.semanticMatch ?? null,
      traceMetadata: taskResult.traceMetadata ?? {},
      referenceFlowRevision: execution.schemaVersion,
      referenceNodeSnapshot,
      isStale: false,
      staleReasons: [],
      preserveOutputFormat: dto?.preserveOutputFormat ?? false,
      replayConfig: {
        replayOutputFormat: dto?.replayConfig?.replayOutputFormat ?? false,
        replayToolTrace: dto?.replayConfig?.replayToolTrace ?? false,
        replayReasoningChain: dto?.replayConfig?.replayReasoningChain ?? true,
      },
    }]);

    if (lastReplay) {
      await this.replayModel.updateOne(
        { _id: lastReplay._id },
        { status: FlowReplayValidationStatus.INACTIVE },
      );
    }

    return replay;
  }

  async listTaskReplays(flowId: string, taskId: string): Promise<FlowValidatedReplayDocument[]> {
    return this.replayModel.find({ flowId, taskId }).sort({ validationVersion: -1 }).exec();
  }

  async activateTaskReplay(flowId: string, taskId: string, replayId: string): Promise<FlowValidatedReplayDocument> {
    await this.replayModel.updateMany(
      { flowId, taskId, status: FlowReplayValidationStatus.ACTIVE },
      { status: FlowReplayValidationStatus.INACTIVE },
    );

    const updated = await this.replayModel.findOneAndUpdate(
      { _id: replayId, flowId, taskId },
      { status: FlowReplayValidationStatus.ACTIVE },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Replay not found');
    return updated;
  }

  async updateTaskReplayFormatGuide(
    flowId: string,
    taskId: string,
    replayId: string,
    dto: UpdateReplayFormatGuidePayload,
  ): Promise<FlowValidatedReplayDocument> {
    const existing = await this.replayModel.findOne({ _id: replayId, flowId, taskId }).lean();
    if (!existing) throw new NotFoundException('Replay not found');

    const preserveOutputFormat = dto.preserveOutputFormat ?? existing.preserveOutputFormat ?? false;
    const outputFormatGuide = dto.outputFormatGuide ?? existing.outputFormatGuide ?? null;
    const outputContract = this.replayBaselineService.buildOutputContractFromReplay({
      output: existing.referenceOutput ?? null,
      preserveOutputFormat,
      outputFormatGuide,
      existingOutputContract: existing.outputContract ?? null,
    });
    const fingerprints = existing.fingerprints
      ? {
        ...existing.fingerprints,
        outputContractHash: this.replayBaselineService.buildOutputContractHash(outputContract),
      }
      : existing.fingerprints;

    const updated = await this.replayModel.findOneAndUpdate(
      { _id: replayId, flowId, taskId },
      {
        $set: {
          outputFormatGuide,
          preserveOutputFormat,
          outputContract,
          ...(fingerprints ? { fingerprints } : {}),
          ...(dto.replayConfig?.replayOutputFormat != null ? { 'replayConfig.replayOutputFormat': dto.replayConfig.replayOutputFormat } : {}),
          ...(dto.replayConfig?.replayToolTrace != null ? { 'replayConfig.replayToolTrace': dto.replayConfig.replayToolTrace } : {}),
          ...(dto.replayConfig?.replayReasoningChain != null ? { 'replayConfig.replayReasoningChain': dto.replayConfig.replayReasoningChain } : {}),
        },
      },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Replay not found');
    return updated;
  }

  async updateTaskReplayLabel(
    flowId: string,
    taskId: string,
    replayId: string,
    label: string | null,
  ): Promise<FlowValidatedReplayDocument> {
    const updated = await this.replayModel.findOneAndUpdate(
      { _id: replayId, flowId, taskId },
      { $set: { label } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Replay not found');
    return updated;
  }

  async deleteTaskReplay(flowId: string, taskId: string, replayId: string): Promise<{ removed: boolean; wasActive: boolean }> {
    const existing = await this.replayModel.findOne({ _id: replayId, flowId, taskId }).lean();
    if (!existing) return { removed: false, wasActive: false };
    const wasActive = existing.status === FlowReplayValidationStatus.ACTIVE;
    await this.replayModel.deleteOne({ _id: replayId });
    return { removed: true, wasActive };
  }

  async getActiveReplay(flowId: string, taskId: string): Promise<FlowValidatedReplayDocument | null> {
    return this.replayModel.findOne({ flowId, taskId, status: FlowReplayValidationStatus.ACTIVE }).exec();
  }

  async getActiveReplays(flowId: string, taskIds: string[]): Promise<FlowValidatedReplayDocument[]> {
    return this.replayModel.find({
      flowId,
      taskId: { $in: taskIds },
      status: FlowReplayValidationStatus.ACTIVE,
    }).exec();
  }

  private findReferenceNodeSnapshot(snapshot: unknown, taskId: string): Record<string, unknown> | null {
    if (!snapshot || typeof snapshot !== 'object') {
      return null;
    }

    const nodes = (snapshot as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) {
      return null;
    }

    const matched = nodes.find((node) => node && typeof node === 'object' && (node as { id?: unknown }).id === taskId);
    return matched && typeof matched === 'object' ? matched as Record<string, unknown> : null;
  }

  private resolveTaskTitle(nodeSnapshot: Record<string, unknown> | null, taskId: string): string {
    const label = typeof nodeSnapshot?.label === 'string' && nodeSnapshot.label.trim() !== ''
      ? nodeSnapshot.label.trim()
      : null;
    return label ?? taskId;
  }

  private resolveTaskDescription(nodeSnapshot: Record<string, unknown> | null): string | null {
    const metadata = nodeSnapshot?.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const description = (metadata as Record<string, unknown>).description;
    return typeof description === 'string' && description.trim() !== '' ? description.trim() : null;
  }

  private resolveReferenceExecutionNumber(execution: Record<string, unknown>): number {
    const executionNumber = execution.executionNumber;
    return typeof executionNumber === 'number' && Number.isFinite(executionNumber) && executionNumber > 0
      ? executionNumber
      : 1;
  }
}
