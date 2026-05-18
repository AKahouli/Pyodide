import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@modules/exceptions/exceptions/http.exceptions';
import { FlowExecution, FlowExecutionDocument } from '../../schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../../schemas/playbook-flow-task-result.schema';
import { FlowOutputFormat, FlowOutputFormatDocument, OutputFormatStatus } from '../../schemas/playbook-flow-output-format.schema';
import { PlaybookFlowDesignGrpcService } from '../playbook-flow-design-grpc.service';
import { PlaybookFlowStreamEventsService } from '../playbook-flow-stream-events.service';
import { PlaybookFlowExecutionAdvisorMapper } from './playbook-flow-execution-advisor.mapper';
import type {
  FlowExecutionAdvisorTaskResponse,
  FlowExecutionJudgeHistoryEntry,
} from '../../interfaces/playbook-flow-execution-advisor.interface';
import type { RunFlowExecutionAdvisorDto } from '../../dto/run-flow-execution-advisor.dto';
import type { FlowNode } from '../../schemas/playbook-flow.schema';

@Injectable()
export class PlaybookFlowExecutionAdvisorService {
  private readonly logger = new Logger(PlaybookFlowExecutionAdvisorService.name);

  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name)
    private readonly taskResultModel: Model<FlowTaskResultDocument>,
    @InjectModel(FlowOutputFormat.name)
    private readonly outputFormatModel: Model<FlowOutputFormatDocument>,
    private readonly grpcService: PlaybookFlowDesignGrpcService,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    private readonly mapper: PlaybookFlowExecutionAdvisorMapper,
  ) {}

  async runTaskEvaluation(
    executionId: string,
    taskId: string,
    ownerId: string,
    dto?: RunFlowExecutionAdvisorDto,
  ): Promise<FlowExecutionAdvisorTaskResponse> {
    const execution = await this.executionModel.findById(executionId).select('+snapshot').lean().exec();
    if (!execution || String(execution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    }

    const snapshot = (execution.snapshot ?? null) as { nodes?: FlowNode[] } | null;
    const node = snapshot?.nodes?.find((candidate) => candidate.id === taskId) ?? null;
    if (!node) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND, 'Playbook task not found');
    }

    const query: Record<string, unknown> = { executionId, taskId };
    if (typeof dto?.iteration === 'number') {
      query.iteration = dto.iteration;
    }

    const taskResult = await this.taskResultModel
      .findOne(query)
      .sort(typeof dto?.iteration === 'number' ? {} : { iteration: -1 })
      .exec();
    if (!taskResult) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND, 'Task result not found');
    }
    if (taskResult.status !== 'completed') {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Advisor evaluation requires a completed task result.');
    }

    if (!this.grpcService.isAvailable) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR, 'AI service is unavailable.');
    }

    const existingHistory: FlowExecutionJudgeHistoryEntry[] = Array.isArray(taskResult.judgeHistory)
      ? taskResult.judgeHistory.map((entry: any) => ({
          id: String(entry.id),
          createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : String(entry.createdAt || ''),
          attemptNumber: typeof entry.attemptNumber === 'number' ? entry.attemptNumber : null,
          model: typeof entry.model === 'string' ? entry.model : null,
          judgeResult: entry.judgeResult,
        }))
      : [];
    const nextAttemptNumber = existingHistory.length + 1;

    taskResult.judgeStatus = 'evaluating';
    taskResult.judgeError = null;
    await taskResult.save();
    this.streamEvents.emitStepJudgeStarted(ownerId, executionId, taskId, taskResult.iteration);

    const expectedResult = this.resolveExpectedResult(node);
    const outputFormatGuide = await this.loadOutputFormatGuide(execution.flowId, taskId);
    const baselineOutput = null;

    try {
      const grpcRequest = this.mapper.buildEvaluateTaskRequest({
        executionId,
        ownerId,
        flowId: execution.flowId,
        node,
        taskResult,
        expectedResult,
        outputFormatGuide,
        baselineOutput,
      });
      const grpcResponse = await this.grpcService.evaluateTask(grpcRequest);
      const judgeResult = this.mapper.mapGrpcJudgeResult(grpcResponse as Record<string, unknown>);
      const historyEntry = this.mapper.buildHistoryEntry(judgeResult, this.extractModel(grpcResponse), nextAttemptNumber);

      taskResult.judgeStatus = 'evaluated';
      taskResult.judgeResult = judgeResult as any;
      taskResult.judgeError = null;
      taskResult.judgeHistory = [...existingHistory, historyEntry] as any;
      await taskResult.save();

      this.streamEvents.emitStepJudgeUpdated(ownerId, executionId, taskId, {
        judgeStatus: 'evaluated',
        judgeResult,
        judgeError: null,
        judgeHistoryEntry: historyEntry,
      }, taskResult.iteration);

      return this.mapper.buildResponse({
        executionId,
        taskId,
        iteration: taskResult.iteration,
        taskStatus: taskResult.status,
        taskOutput: taskResult.output,
        taskError: taskResult.error,
        judgeStatus: 'evaluated',
        judgeResult,
        judgeError: null,
        judgeHistory: [...existingHistory, historyEntry],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Advisor evaluation failed';
      this.logger.warn(`Advisor evaluation failed for ${executionId}:${taskId}: ${message}`);
      taskResult.judgeStatus = 'failed';
      taskResult.judgeError = message;
      await taskResult.save();

      this.streamEvents.emitStepJudgeUpdated(ownerId, executionId, taskId, {
        judgeStatus: 'failed',
        judgeError: message,
      }, taskResult.iteration);

      return this.mapper.buildResponse({
        executionId,
        taskId,
        iteration: taskResult.iteration,
        taskStatus: taskResult.status,
        taskOutput: taskResult.output,
        taskError: taskResult.error,
        judgeStatus: 'failed',
        judgeResult: null,
        judgeError: message,
        judgeHistory: existingHistory,
      });
    }
  }

  private resolveExpectedResult(node: FlowNode): string | null {
    const metadata = (node.metadata ?? {}) as Record<string, unknown>;
    const value = metadata.expectedResult;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private async loadOutputFormatGuide(flowId: string, taskId: string): Promise<string | null> {
    const template = await this.outputFormatModel.findOne({
      flowId: new Types.ObjectId(flowId),
      nodeId: taskId,
      status: OutputFormatStatus.ACTIVE,
    }).lean().exec();
    return typeof template?.formatGuide === 'string' && template.formatGuide.trim().length > 0
      ? template.formatGuide
      : null;
  }

  private extractModel(response: unknown): string | null {
    if (!response || typeof response !== 'object') {
      return null;
    }
    const record = response as Record<string, unknown>;
    return typeof record.model === 'string' && record.model.trim().length > 0
      ? record.model
      : null;
  }
}
