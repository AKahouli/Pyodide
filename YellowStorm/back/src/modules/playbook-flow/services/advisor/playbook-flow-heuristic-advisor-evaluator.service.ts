import { Injectable } from '@nestjs/common';
import { PlaybookFlowDesignGrpcService } from '../playbook-flow-design-grpc.service';
import { PlaybookFlowExecutionAdvisorMapper } from './playbook-flow-execution-advisor.mapper';
import type { FlowNode } from '../../models/playbook-flow.model';
import type { TaskResultRecord } from '../../persistence/task-result.repository';
import type { FlowExecutionAdvisorEvaluationResult } from '../../interfaces/playbook-flow-execution-advisor.interface';

@Injectable()
export class PlaybookFlowHeuristicAdvisorEvaluatorService {
  constructor(
    private readonly grpcService: PlaybookFlowDesignGrpcService,
    private readonly mapper: PlaybookFlowExecutionAdvisorMapper,
  ) {}

  async evaluate(params: {
    executionId: string;
    ownerId: string;
    flowId: string;
    node: FlowNode;
    taskResult: TaskResultRecord | Record<string, unknown>;
    expectedResult: string | null;
    outputFormatGuide: string | null;
    baselineOutput: string | null;
  }): Promise<FlowExecutionAdvisorEvaluationResult> {
    const grpcRequest = this.mapper.buildEvaluateTaskRequest(params);
    const grpcResponse = await this.grpcService.evaluateTask(grpcRequest);

    return {
      judgeResult: this.mapper.mapGrpcJudgeResult(grpcResponse as Record<string, unknown>),
      model: this.extractModel(grpcResponse),
      scoringMode: 'heuristic',
      usage: null,
      llmPromptTrace: [],
    };
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
