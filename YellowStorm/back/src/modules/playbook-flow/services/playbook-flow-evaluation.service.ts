import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../schemas/playbook-flow-task-result.schema';
import {
  FlowEvaluationBaseline,
  FlowEvaluationBaselineDocument,
} from '../schemas/playbook-flow-evaluation-baseline.schema';
import {
  FlowEvaluationExecution,
  FlowEvaluationExecutionDocument,
} from '../schemas/playbook-flow-evaluation-execution.schema';

export interface PersistEvaluationParams {
  flowId: string;
  executionId: string;
  taskId: string;
  iteration: number;
  taskTitle: string;
  mode?: string;
  status?: string;
  score?: number;
  verdict?: string;
  summary?: string;
  findings?: Array<{ severity: string; category: string; message: string; sourceTaskId?: string }>;
}

@Injectable()
export class PlaybookFlowEvaluationService {
  constructor(
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name) private readonly taskResultModel: Model<FlowTaskResultDocument>,
    @InjectModel(FlowEvaluationBaseline.name) private readonly baselineModel: Model<FlowEvaluationBaselineDocument>,
    @InjectModel(FlowEvaluationExecution.name) private readonly evaluationExecutionModel: Model<FlowEvaluationExecutionDocument>,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowEvaluationService'); }

  async getActiveBaseline(flowId: string, taskId: string, iteration?: number): Promise<FlowEvaluationBaselineDocument | null> {
    const query: Record<string, unknown> = { flowId, taskId, replacedAt: null };
    if (iteration !== undefined) query.iteration = iteration;
    return this.baselineModel.findOne(query).sort({ createdAt: -1 }).exec();
  }

  async listEvaluationExecutions(flowId: string, taskId?: string): Promise<FlowEvaluationExecutionDocument[]> {
    const filter: Record<string, unknown> = { flowId };
    if (taskId) filter.taskId = taskId;
    return this.evaluationExecutionModel.find(filter).sort({ createdAt: -1 }).limit(50).exec();
  }

  async getEvaluationExecution(flowId: string, executionId: string): Promise<FlowEvaluationExecutionDocument[]> {
    return this.evaluationExecutionModel.find({ flowId, executionId }).sort({ iteration: 1 }).exec();
  }

  async removeActiveBaseline(flowId: string, taskId: string): Promise<void> {
    await this.baselineModel.updateMany(
      { flowId, taskId, replacedAt: null },
      { $set: { replacedAt: new Date() } },
    );
  }

  async persistEvaluationExecution(params: PersistEvaluationParams): Promise<FlowEvaluationExecutionDocument> {
    const [record] = await this.evaluationExecutionModel.create([{
      flowId: params.flowId,
      executionId: params.executionId,
      taskId: params.taskId,
      iteration: params.iteration ?? 0,
      taskTitle: params.taskTitle,
      mode: params.mode ?? 'hybrid',
      status: params.status ?? 'completed',
      score: params.score,
      verdict: params.verdict,
      summary: params.summary,
      findings: params.findings ?? [],
    }]);
    return record;
  }

  async replaceBaselineFromExecution(
    flowId: string,
    taskId: string,
    iteration: number,
    executionId: string,
    userId: string,
  ): Promise<FlowEvaluationBaselineDocument> {
    const execution = await this.executionModel.findOne({ id: executionId }).lean();
    if (!execution) throw new NotFoundException('Execution not found');

    await this.baselineModel.updateMany(
      { flowId, taskId, replacedAt: null },
      { $set: { replacedAt: new Date() } },
    );

    const [baseline] = await this.baselineModel.create([{
      flowId,
      taskId,
      iteration,
      sourceExecutionId: executionId,
      sourceMode: 'selected_execution',
      createdByUserId: userId,
    }]);

    return baseline;
  }

  async replaceBaselineFromCurrentEvaluationExecution(
    flowId: string,
    taskId: string,
    iteration: number,
    executionId: string,
    evaluationExecutionId: string,
    userId: string,
  ): Promise<FlowEvaluationBaselineDocument> {
    return this.replaceBaselineFromExecution(flowId, taskId, iteration, executionId, userId);
  }
}
