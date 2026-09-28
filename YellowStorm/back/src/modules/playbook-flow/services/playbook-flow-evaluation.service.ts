import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { ExecutionRepository } from '../persistence/execution.repository';
import {
  EvaluationBaselineRepository,
  type FlowEvaluationBaselineRecord,
} from '../persistence/evaluation-baseline.repository';
import {
  EvaluationExecutionRepository,
  type FlowEvaluationExecutionRecord,
} from '../persistence/evaluation-execution.repository';

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
    private readonly executionRepository: ExecutionRepository,
    private readonly baselineRepository: EvaluationBaselineRepository,
    private readonly evaluationExecutionRepository: EvaluationExecutionRepository,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowEvaluationService'); }

  async getActiveBaseline(flowId: string, taskId: string, iteration?: number): Promise<FlowEvaluationBaselineRecord | null> {
    return this.baselineRepository.findActive(flowId, taskId, iteration);
  }

  async listEvaluationExecutions(flowId: string, taskId?: string): Promise<FlowEvaluationExecutionRecord[]> {
    return this.evaluationExecutionRepository.listByFlow(flowId, { taskId, limit: 50 });
  }

  async getEvaluationExecution(flowId: string, executionId: string): Promise<FlowEvaluationExecutionRecord[]> {
    return this.evaluationExecutionRepository.listForExecution(flowId, executionId);
  }

  async removeActiveBaseline(flowId: string, taskId: string): Promise<void> {
    await this.baselineRepository.retireActive(flowId, taskId);
  }

  async persistEvaluationExecution(params: PersistEvaluationParams): Promise<FlowEvaluationExecutionRecord> {
    const record = await this.evaluationExecutionRepository.create({
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
    });
    if (!record) throw new NotFoundException('Flow not found');
    return record;
  }

  async replaceBaselineFromExecution(
    flowId: string,
    taskId: string,
    iteration: number,
    executionId: string,
    userId: string,
  ): Promise<FlowEvaluationBaselineRecord> {
    const execution = await this.executionRepository.findById(executionId);
    if (!execution) throw new NotFoundException('Execution not found');

    // The task's active baselines are retired and the new one inserted in one transaction.
    const baseline = await this.baselineRepository.replaceActive({
      flowId,
      taskId,
      iteration,
      sourceExecutionId: executionId,
      sourceMode: 'selected_execution',
      createdByUserId: userId,
    });
    if (!baseline) throw new NotFoundException('Flow not found');
    return baseline;
  }

  async replaceBaselineFromCurrentEvaluationExecution(
    flowId: string,
    taskId: string,
    iteration: number,
    executionId: string,
    evaluationExecutionId: string,
    userId: string,
  ): Promise<FlowEvaluationBaselineRecord> {
    return this.replaceBaselineFromExecution(flowId, taskId, iteration, executionId, userId);
  }
}
