import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PlaybookExecution,
  PlaybookExecutionDocument,
  StepStatus,
} from '../schemas/playbook-execution.schema';
import { UsageService } from '../../usage/usage.service';
import { UsageType } from '../../usage/schemas/usage.schema';
import { LoggerService } from '../../logger';
import {
  mergeWithExistingHumanFeedback,
} from '../utils/execution.utils';
import type { BufferedStepResult } from '../utils/execution.utils';

@Injectable()
export class PlaybookExecutionBufferService {
  readonly activeStepBuffers = new Map<string, Map<string, BufferedStepResult>>();

  static readonly STATUS_WEIGHT: Record<string, number> = {
    [StepStatus.PENDING]: 0,
    [StepStatus.RUNNING]: 1,
    [StepStatus.COMPLETED]: 2,
    [StepStatus.FAILED]: 2,
    [StepStatus.SKIPPED]: 2,
  };

  constructor(
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    private readonly usageService: UsageService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookExecutionBufferService');
  }

  setBuffer(executionId: string, stepBuffer: Map<string, BufferedStepResult>): void {
    this.activeStepBuffers.set(executionId, stepBuffer);
  }

  getBuffer(executionId: string): Map<string, BufferedStepResult> | undefined {
    return this.activeStepBuffers.get(executionId);
  }

  getOrCreateBuffer(executionId: string): Map<string, BufferedStepResult> {
    let buf = this.activeStepBuffers.get(executionId);
    if (!buf) {
      buf = new Map<string, BufferedStepResult>();
      this.activeStepBuffers.set(executionId, buf);
    }
    return buf;
  }

  deleteBuffer(executionId: string): void {
    this.activeStepBuffers.delete(executionId);
  }

  deleteTaskFromBuffer(executionId: string, taskId: string): void {
    const buf = this.activeStepBuffers.get(executionId);
    if (buf) {
      buf.delete(taskId);
      if (buf.size === 0) {
        this.activeStepBuffers.delete(executionId);
      }
    }
  }

  async flushStepBuffer(
    executionId: string,
    stepBuffer: Map<string, BufferedStepResult>,
    postFlush?: (taskId: string, buffered: BufferedStepResult) => Promise<void>,
  ): Promise<void> {
    if (stepBuffer.size === 0) return;

    this.logger.log('Flushing step buffer to DB', {
      executionId,
      stepCount: stepBuffer.size,
    });

    const execution = await this.executionModel
      .findById(executionId)
      .select('taskResults.taskId taskResults.components')
      .lean()
      .exec();
    const hfMap = new Map<string, any[]>();
    for (const tr of execution?.taskResults || []) {
      const hf = ((tr as any).components || []).filter((c: any) => c.type === 'humanFeedback');
      if (hf.length > 0) hfMap.set((tr as any).taskId, hf);
    }

    for (const [taskId, buffered] of stepBuffer) {
      await this.flushBufferedTaskResult(executionId, taskId, buffered, hfMap.get(taskId) || []);
      if (postFlush) {
        await postFlush(taskId, buffered);
      }
    }
  }

  async flushBufferedTaskResult(
    executionId: string,
    taskId: string,
    buffered: BufferedStepResult,
    existingHumanFeedback: any[] = [],
  ): Promise<void> {
    const fields: Record<string, any> = {
      status: buffered.status,
      startedAt: buffered.startedAt,
    };
    if (buffered.output !== undefined) fields.output = buffered.output;
    if (buffered.error !== undefined) fields.error = buffered.error;
    if (buffered.durationMs !== undefined) fields.durationMs = buffered.durationMs;
    if (buffered.completedAt !== undefined) fields.completedAt = buffered.completedAt;
    if (buffered.inputTokens !== undefined) fields.inputTokens = buffered.inputTokens;
    if (buffered.outputTokens !== undefined) fields.outputTokens = buffered.outputTokens;
    if (buffered.totalTokens !== undefined) fields.totalTokens = buffered.totalTokens;
    if (buffered.modelName !== undefined) fields.modelName = buffered.modelName;
    if (buffered.semanticMatch !== undefined) fields.semanticMatch = buffered.semanticMatch;
    if (buffered.toolTrace !== undefined) fields.toolTrace = buffered.toolTrace;
    if ((buffered as any).llmPromptTrace !== undefined)
      fields.llmPromptTrace = (buffered as any).llmPromptTrace;
    if ((buffered as any).artifacts !== undefined) fields.artifacts = (buffered as any).artifacts;
    if ((buffered as any).artifactsByPort !== undefined) fields.artifactsByPort = (buffered as any).artifactsByPort;
    if ((buffered as any).iteratorIterations !== undefined)
      fields.iteratorIterations = (buffered as any).iteratorIterations;
    if (buffered.components !== undefined) {
      fields.components = mergeWithExistingHumanFeedback(
        existingHumanFeedback,
        buffered.components,
      );
    }

    const $set: Record<string, any> = {};
    for (const [key, value] of Object.entries(fields)) {
      $set[`taskResults.$[elem].${key}`] = value;
    }

    await this.executionModel.findByIdAndUpdate(
      executionId,
      { $set },
      { arrayFilters: [{ 'elem.taskId': taskId }] },
    );
  }

  async recordBufferedTaskUsage(
    userId: string,
    executionId: string,
    buffered: BufferedStepResult,
    startedAt: Date,
  ): Promise<void> {
    const inputTokens = buffered.inputTokens ?? 0;
    const outputTokens = buffered.outputTokens ?? 0;
    const totalTokens = buffered.totalTokens ?? 0;
    if (totalTokens <= 0) {
      return;
    }

    await this.executionModel.findByIdAndUpdate(executionId, {
      $inc: {
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
        totalTokens,
      },
    });

    this.usageService
      .recordUsage({
        userId,
        inputTokens,
        outputTokens,
        usageType: UsageType.PLAYBOOK,
        modelName: buffered.modelName || undefined,
        endpoint: 'playbook.executeStep.stream',
        durationMs: Date.now() - startedAt.getTime(),
      })
      .catch((err) =>
        this.logger.warn('Failed to record step stream usage', { error: (err as Error).message }),
      );
  }

  async recordStreamUsage(
    userId: string,
    executionId: string,
    stepBuffer: Map<string, BufferedStepResult>,
    startedAt: Date,
  ): Promise<void> {
    let aggInput = 0,
      aggOutput = 0,
      aggTotal = 0;
    let lastModel: string | undefined;
    for (const buffered of stepBuffer.values()) {
      if (buffered.inputTokens) aggInput += buffered.inputTokens;
      if (buffered.outputTokens) aggOutput += buffered.outputTokens;
      if (buffered.totalTokens) aggTotal += buffered.totalTokens;
      if (buffered.modelName) lastModel = buffered.modelName;
    }
    if (aggTotal > 0) {
      await this.executionModel.findByIdAndUpdate(executionId, {
        $inc: {
          totalInputTokens: aggInput,
          totalOutputTokens: aggOutput,
          totalTokens: aggTotal,
        },
      });
      this.usageService
        .recordUsage({
          userId,
          inputTokens: aggInput,
          outputTokens: aggOutput,
          usageType: UsageType.PLAYBOOK,
          modelName: lastModel,
          endpoint: 'playbook.workflow',
          durationMs: Date.now() - startedAt.getTime(),
        })
        .catch((err) =>
          this.logger.warn('Failed to record workflow usage', { error: (err as Error).message }),
        );
    }
  }

  mergeTaskResultWithBuffer(dbTr: any, buffered: BufferedStepResult): any {
    const dbWeight = PlaybookExecutionBufferService.STATUS_WEIGHT[dbTr.status] ?? 0;
    const bufWeight = PlaybookExecutionBufferService.STATUS_WEIGHT[buffered.status] ?? 0;
    if (bufWeight < dbWeight) return dbTr;

    return {
      ...dbTr,
      status: buffered.status,
      output: buffered.output !== undefined ? buffered.output : dbTr.output,
      error: buffered.error !== undefined ? buffered.error : dbTr.error,
      durationMs: buffered.durationMs !== undefined ? buffered.durationMs : dbTr.durationMs,
      startedAt: buffered.startedAt !== undefined ? buffered.startedAt : dbTr.startedAt,
      completedAt: buffered.completedAt !== undefined ? buffered.completedAt : dbTr.completedAt,
      components: buffered.components !== undefined ? buffered.components : dbTr.components,
      toolTrace: buffered.toolTrace !== undefined ? buffered.toolTrace : dbTr.toolTrace,
      llmPromptTrace:
        (buffered as any).llmPromptTrace !== undefined
          ? (buffered as any).llmPromptTrace
          : dbTr.llmPromptTrace,
      inputTokens: buffered.inputTokens !== undefined ? buffered.inputTokens : dbTr.inputTokens,
      outputTokens: buffered.outputTokens !== undefined ? buffered.outputTokens : dbTr.outputTokens,
      totalTokens: buffered.totalTokens !== undefined ? buffered.totalTokens : dbTr.totalTokens,
      modelName: buffered.modelName !== undefined ? buffered.modelName : dbTr.modelName,
      semanticMatch:
        buffered.semanticMatch !== undefined ? buffered.semanticMatch : dbTr.semanticMatch,
      judgeStatus: buffered.judgeStatus !== undefined ? buffered.judgeStatus : dbTr.judgeStatus,
      judgeResult: buffered.judgeResult !== undefined ? buffered.judgeResult : dbTr.judgeResult,
      judgeHistory: buffered.judgeHistory !== undefined ? buffered.judgeHistory : dbTr.judgeHistory,
      evaluationHistory:
        buffered.evaluationHistory !== undefined
          ? buffered.evaluationHistory
          : dbTr.evaluationHistory,
      stepExecutions: dbTr.stepExecutions || [],
      artifacts:
        (buffered as any).artifacts !== undefined ? (buffered as any).artifacts : dbTr.artifacts,
      iteratorIterations:
        (buffered as any).iteratorIterations !== undefined
          ? (buffered as any).iteratorIterations
          : dbTr.iteratorIterations,
    };
  }
}
