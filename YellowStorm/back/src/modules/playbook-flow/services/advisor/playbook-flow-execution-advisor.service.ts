import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  BadRequestException,
  NotFoundException,
} from '@modules/exceptions/exceptions/http.exceptions';
import { FlowExecution, FlowExecutionDocument } from '../../schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../../schemas/playbook-flow-task-result.schema';
import { FlowOutputFormat, FlowOutputFormatDocument, OutputFormatStatus } from '../../schemas/playbook-flow-output-format.schema';
import { PlaybookFlowStreamEventsService } from '../playbook-flow-stream-events.service';
import { PlaybookFlowExecutionAdvisorMapper } from './playbook-flow-execution-advisor.mapper';
import { PlaybookFlowHeuristicAdvisorEvaluatorService } from './playbook-flow-heuristic-advisor-evaluator.service';
import { PlaybookFlowLlmAdvisorEvaluatorService } from './playbook-flow-llm-advisor-evaluator.service';
import type {
  FlowExecutionAdvisorEvaluationResult,
  FlowExecutionAdvisorTaskResponse,
  FlowExecutionJudgeHistoryEntry,
  FlowExecutionJudgeResult,
  AdvisorRemediationItem,
  AdvisorRemediationCategory,
} from '../../interfaces/playbook-flow-execution-advisor.interface';
import type { RunFlowExecutionAdvisorDto } from '../../dto/run-flow-execution-advisor.dto';
import type { AdvisorScoringMode, FlowNode } from '../../schemas/playbook-flow.schema';

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
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    private readonly mapper: PlaybookFlowExecutionAdvisorMapper,
    private readonly heuristicEvaluator: PlaybookFlowHeuristicAdvisorEvaluatorService,
    private readonly llmEvaluator: PlaybookFlowLlmAdvisorEvaluatorService,
  ) {}

  async getRemediations(executionId: string, ownerId: string, taskId?: string): Promise<AdvisorRemediationItem[]> {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution || String(execution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    }

    const filter: Record<string, unknown> = { executionId };
    if (taskId) filter.taskId = taskId;

    const taskResults = await this.taskResultModel.find(filter).lean().exec();
    const items: AdvisorRemediationItem[] = [];

    for (const tr of taskResults) {
      const judgeResult = (tr as any).judgeResult as FlowExecutionJudgeResult | null | undefined;
      if (!judgeResult) continue;

      const scope = taskId ? 'task' as const : 'playbook' as const;
      const targetTaskId = taskId ?? null;

      const fieldMappings: Array<{ key: keyof FlowExecutionJudgeResult; category: AdvisorRemediationCategory; defaultSelected: boolean }> = [
        { key: 'missingFacts', category: 'structure', defaultSelected: true },
        { key: 'incoherences', category: 'prompt', defaultSelected: true },
        { key: 'unsupportedClaims', category: 'contract', defaultSelected: true },
        { key: 'handoffRisks', category: 'handoff', defaultSelected: true },
        { key: 'toolSelectionIssues', category: 'tooling', defaultSelected: true },
        { key: 'missingToolCalls', category: 'tooling', defaultSelected: true },
        { key: 'redundantToolCalls', category: 'tooling', defaultSelected: false },
        { key: 'toolOutputUseIssues', category: 'tooling', defaultSelected: true },
        { key: 'toolSequencingIssues', category: 'tooling', defaultSelected: true },
        { key: 'toolUsageStrengths', category: 'evidence', defaultSelected: false },
        { key: 'rewriteHints', category: 'prompt', defaultSelected: true },
      ];

      for (const { key, category, defaultSelected } of fieldMappings) {
        const entries = judgeResult[key];
        if (!Array.isArray(entries)) continue;
        entries.forEach((description: string, index: number) => {
          items.push({
            id: `${tr.taskId}-${category}-${index}`,
            category,
            scope,
            targetTaskId,
            title: description.length > 80 ? description.slice(0, 80) + '...' : description,
            description,
            rationale: undefined,
            editable: true,
            defaultSelected,
            source: { kind: 'judge_result', field: category, index },
          });
        });
      }
    }

    return items;
  }

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
    const executionScoringMode = execution.advisorScoringMode === 'heuristic' ? 'heuristic' : 'llm';
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

    const existingHistory: FlowExecutionJudgeHistoryEntry[] = Array.isArray(taskResult.judgeHistory)
      ? taskResult.judgeHistory.map((entry: any) => ({
          id: String(entry.id),
          createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : String(entry.createdAt || ''),
          attemptNumber: typeof entry.attemptNumber === 'number' ? entry.attemptNumber : null,
          model: typeof entry.model === 'string' ? entry.model : null,
          scoringMode: entry.scoringMode === 'heuristic' ? 'heuristic' : 'llm',
          usage: entry.usage ?? null,
          llmPromptTrace: Array.isArray(entry.llmPromptTrace) ? entry.llmPromptTrace : [],
          judgeResult: entry.judgeResult,
        }))
      : [];
    const nextAttemptNumber = existingHistory.length + 1;
    const scoringMode = dto?.advisorScoringMode ?? executionScoringMode;

    taskResult.judgeStatus = 'evaluating';
    taskResult.judgeError = null;
    await taskResult.save();
    this.streamEvents.emitStepJudgeStarted(ownerId, executionId, taskId, taskResult.iteration, scoringMode);

    const expectedResult = this.resolveExpectedResult(node);
    const outputFormatGuide = await this.loadOutputFormatGuide(execution.flowId, taskId);
    const baselineOutput = null;
    const snapshotRecord = (execution.snapshot ?? null) as Record<string, unknown> | null;
    const workflowGoal = typeof snapshotRecord?.description === 'string'
      ? snapshotRecord.description
      : typeof snapshotRecord?.name === 'string'
        ? snapshotRecord.name
        : '';
    const upstreamContextJson = this.buildUpstreamContextJson(snapshot?.nodes ?? [], taskResult.taskId);

    try {
      const evaluation = await this.evaluateTask({
        executionId,
        ownerId,
        flowId: execution.flowId,
        node,
        taskResult,
        expectedResult,
        outputFormatGuide,
        baselineOutput,
        workflowGoal,
        upstreamContextJson,
        scoringMode,
      });
      const historyEntry = this.mapper.buildHistoryEntry(evaluation, nextAttemptNumber);

      taskResult.judgeStatus = 'evaluated';
      taskResult.judgeResult = evaluation.judgeResult as any;
      taskResult.judgeScoringMode = evaluation.scoringMode;
      taskResult.judgeError = null;
      taskResult.judgeHistory = [...existingHistory, historyEntry] as any;
      await taskResult.save();

      this.streamEvents.emitStepJudgeUpdated(ownerId, executionId, taskId, {
        judgeStatus: 'evaluated',
        advisorScoringMode: evaluation.scoringMode,
        judgeResult: evaluation.judgeResult,
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
        judgeScoringMode: evaluation.scoringMode,
        judgeResult: evaluation.judgeResult,
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
        advisorScoringMode: scoringMode,
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
        judgeScoringMode: taskResult.judgeScoringMode ?? scoringMode,
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

  private async evaluateTask(params: {
    executionId: string;
    ownerId: string;
    flowId: string;
    node: FlowNode;
    taskResult: FlowTaskResultDocument;
    expectedResult: string | null;
    outputFormatGuide: string | null;
    baselineOutput: string | null;
    workflowGoal: string;
    upstreamContextJson: string;
    scoringMode: AdvisorScoringMode;
  }): Promise<FlowExecutionAdvisorEvaluationResult> {
    if (params.scoringMode === 'heuristic') {
      return this.heuristicEvaluator.evaluate(params);
    }

    return this.llmEvaluator.evaluate(params);
  }

  private buildUpstreamContextJson(nodes: FlowNode[], taskId: string): string {
    const currentIndex = nodes.findIndex((node) => node.id === taskId);
    if (currentIndex <= 0) {
      return '[]';
    }

    // Keep the context small and deterministic for judge prompts.
    const upstreamNodes = nodes.slice(0, currentIndex).map((node) => ({
      id: node.id,
      label: node.label || node.id,
      description: node.description || '',
    }));

    return JSON.stringify(upstreamNodes, null, 2);
  }
}
