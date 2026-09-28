import { Injectable, NotFoundException } from '@nestjs/common';
import { isObjectId, normalizeObjectId } from '@common/postgres';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { ExecutionRepository } from '../persistence/execution.repository';
import { TaskResultRepository } from '../persistence/task-result.repository';
import { RouterDecisionRepository } from '../persistence/router-decision.repository';
import {
  ValidatedReplayRepository,
  toValidatedReplayJson,
  type FlowValidatedReplayRecord,
  type NewValidatedReplay,
} from '../persistence/validated-replay.repository';
import {
  FlowReplayValidationStatus,
  serializeReplayMode,
  type BuildValidatedReplayBaselineInput,
  type ReplayMode,
} from '../interfaces/playbook-flow-validated-replay.interface';
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

type BaselineTaskResult = BuildValidatedReplayBaselineInput['taskResult'];

@Injectable()
export class PlaybookFlowReplayService {
  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly taskResultRepository: TaskResultRepository,
    private readonly routerDecisionRepository: RouterDecisionRepository,
    private readonly replayRepository: ValidatedReplayRepository,
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly replayBaselineService: PlaybookFlowReplayBaselineService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowReplayService'); }

  async traceReplay(executionId: string, userId: string): Promise<TraceReplayEvent[]> {
    const execution = await this.executionRepository.findOwned(executionId, userId);
    if (!execution) throw new NotFoundException('Execution not found');

    const [taskResults, routerDecisions] = await Promise.all([
      this.taskResultRepository.listForExecution(executionId, { order: 'ended' }),
      this.routerDecisionRepository.listForExecution(executionId),
    ]);

    const events: TraceReplayEvent[] = [];

    for (const tr of taskResults) {
      const ts = tr.startedAt?.toISOString() ?? tr.createdAt?.toISOString() ?? '';
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
            reasoningChain: tr.reasoningChain ?? [],
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
        timestamp: rd.decidedAt?.toISOString() ?? '',
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
    const execution = await this.executionRepository.findOwned(executionId, userId);
    if (!execution) throw new NotFoundException('Execution not found');

    const result = await this.executionService.start(
      execution.flowId,
      userId,
      execution.inputContext ?? undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      execution.executionMode || 'live',
      execution.stepExecutionModes,
      execution.modelIdOverride ?? undefined,
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
  ): Promise<FlowValidatedReplayRecord> {
    const execution = await this.executionRepository.findOwned(executionId, userId, { withSnapshot: true });
    if (!execution) throw new NotFoundException('Execution not found');
    if (!isObjectId(flowId) || execution.flowId !== normalizeObjectId(flowId)) throw new NotFoundException('Execution not found');

    const taskResult = await this.taskResultRepository.find({ executionId, taskId, iteration });
    if (!taskResult) throw new NotFoundException('Task result not found');

    const referenceNodeSnapshot = this.findReferenceNodeSnapshot(execution.snapshot, taskId);
    if (!referenceNodeSnapshot) throw new NotFoundException('Task not found in execution snapshot');

    const taskTitle = this.resolveTaskTitle(referenceNodeSnapshot, taskId);
    const taskDescription = this.resolveTaskDescription(referenceNodeSnapshot);
    const referenceExecutionNumber = this.resolveReferenceExecutionNumber(execution as unknown as Record<string, unknown>);
    const toolTrace = (taskResult.toolTrace ?? []) as unknown as NonNullable<BaselineTaskResult['toolTrace']>;
    const reasoningChain = (taskResult.reasoningChain ?? []) as unknown as NonNullable<BaselineTaskResult['reasoningChain']>;
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
        toolTrace,
        reasoningChain,
        judgeResult: (taskResult.judgeResult ?? null) as BaselineTaskResult['judgeResult'],
      },
      hitlEvents: execution.hitlEvents ?? [],
      preserveOutputFormat: dto?.preserveOutputFormat ?? false,
      outputFormatGuide: undefined,
    });

    // The new version is drawn and the previously latest one made inactive in the same transaction.
    const replay = await this.replayRepository.createNextVersion({
      flowId,
      taskId,
      iteration,
      taskTitle,
      referenceTaskDescription: taskDescription ?? '',
      createdBy: userId,
      referenceExecutionId: executionId,
      referenceExecutionNumber,
      status: FlowReplayValidationStatus.ACTIVE,
      mode: serializeReplayMode(baseline.mode),
      referenceOutput: typeof taskResult.output === 'string' ? taskResult.output : JSON.stringify(taskResult.output ?? ''),
      toolCalls: toolTrace as NewValidatedReplay['toolCalls'],
      reasoningChain,
      llmPromptTrace: (taskResult.llmPromptTrace ?? []) as unknown as NewValidatedReplay['llmPromptTrace'],
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
      referenceUsage: (taskResult.usage ?? null) as NewValidatedReplay['referenceUsage'],
      referenceSemanticMatch: (taskResult.semanticMatch ?? null) as NewValidatedReplay['referenceSemanticMatch'],
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
    });

    return toValidatedReplayJson(replay);
  }

  async listTaskReplays(flowId: string, taskId: string): Promise<FlowValidatedReplayRecord[]> {
    const replays = await this.replayRepository.listByTask(flowId, taskId);
    return replays.map(toValidatedReplayJson);
  }

  async activateTaskReplay(flowId: string, taskId: string, replayId: string): Promise<FlowValidatedReplayRecord> {
    // One statement: the other active baselines of the task are deactivated only when the target exists.
    const updated = await this.replayRepository.activate(replayId, flowId, taskId);
    if (!updated) throw new NotFoundException('Replay not found');
    return toValidatedReplayJson(updated);
  }

  async updateTaskReplayFormatGuide(
    flowId: string,
    taskId: string,
    replayId: string,
    dto: UpdateReplayFormatGuidePayload,
  ): Promise<FlowValidatedReplayRecord> {
    const existing = await this.replayRepository.findInTask(replayId, flowId, taskId);
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

    const updated = await this.replayRepository.update(replayId, flowId, taskId, {
      outputFormatGuide,
      preserveOutputFormat,
      outputContract,
      ...(fingerprints ? { fingerprints } : {}),
      replayConfig: {
        ...(dto.replayConfig?.replayOutputFormat != null ? { replayOutputFormat: dto.replayConfig.replayOutputFormat } : {}),
        ...(dto.replayConfig?.replayToolTrace != null ? { replayToolTrace: dto.replayConfig.replayToolTrace } : {}),
        ...(dto.replayConfig?.replayReasoningChain != null ? { replayReasoningChain: dto.replayConfig.replayReasoningChain } : {}),
      },
    });
    if (!updated) throw new NotFoundException('Replay not found');
    return toValidatedReplayJson(updated);
  }

  async updateTaskReplayLabel(
    flowId: string,
    taskId: string,
    replayId: string,
    label: string | null,
  ): Promise<FlowValidatedReplayRecord> {
    const updated = await this.replayRepository.update(replayId, flowId, taskId, { label });
    if (!updated) throw new NotFoundException('Replay not found');
    return toValidatedReplayJson(updated);
  }

  async deleteTaskReplay(flowId: string, taskId: string, replayId: string): Promise<{ removed: boolean; wasActive: boolean }> {
    const deleted = await this.replayRepository.deleteInTask(replayId, flowId, taskId);
    if (!deleted) return { removed: false, wasActive: false };
    return { removed: true, wasActive: deleted.status === FlowReplayValidationStatus.ACTIVE };
  }

  async getActiveReplay(flowId: string, taskId: string): Promise<FlowValidatedReplayRecord | null> {
    const replay = await this.replayRepository.findActive(flowId, taskId);
    return replay ? toValidatedReplayJson(replay) : null;
  }

  async getActiveReplays(flowId: string, taskIds: string[]): Promise<FlowValidatedReplayRecord[]> {
    const replays = await this.replayRepository.listActiveForTasks(flowId, taskIds);
    return replays.map(toValidatedReplayJson);
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
