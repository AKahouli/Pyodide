import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
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
import { PlaybookFlowIntentService, type PlaybookFlowIntentResponse } from '../playbook-flow-intent.service';
import { PlaybookFlowService } from '../playbook-flow.service';
import type {
  FlowExecutionAdvisorEvaluationResult,
  FlowExecutionAdvisorTaskResponse,
  FlowExecutionJudgeHistoryEntry,
  FlowExecutionJudgeResult,
  AdvisorRemediationItem,
  AdvisorRemediationCategory,
} from '../../interfaces/playbook-flow-execution-advisor.interface';
import type { RunFlowExecutionAdvisorDto } from '../../dto/run-flow-execution-advisor.dto';
import type { PreviewAdvisorRemediationDto } from '../../dto/preview-advisor-remediation.dto';
import type { AdvisorScoringMode, FlowNode } from '../../schemas/playbook-flow.schema';

export interface AdvisorRemediationPreviewResponse {
  suggestion: PlaybookFlowIntentResponse['suggestions'][number];
  suggestions: PlaybookFlowIntentResponse['suggestions'];
  expectedDefinitionRevision: number;
  intent: string;
}

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
    @Inject(forwardRef(() => PlaybookFlowService))
    private readonly flowService: PlaybookFlowService,
    private readonly intentService: PlaybookFlowIntentService,
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

  async previewRemediation(
    flowId: string,
    ownerId: string,
    dto: PreviewAdvisorRemediationDto,
  ): Promise<AdvisorRemediationPreviewResponse> {
    const execution = await this.executionModel.findById(dto.executionId).lean().exec();
    if (!execution || String(execution.ownerId) !== String(ownerId) || String(execution.flowId) !== String(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    }

    const flow = await this.flowService.findOne(flowId, ownerId) as any;
    const targetNode = dto.targetTaskId
      ? (flow.nodes || []).find((node: { id: string }) => node.id === dto.targetTaskId) || null
      : null;

    if (dto.mode === 'optimize-step' && (!dto.targetTaskId || !targetNode)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND, 'Playbook task not found');
    }

    const intent = this.buildRemediationIntent(dto, targetNode);
    const analysis = await this.intentService.analyze(flowId, ownerId, {
      intent,
      selectedTaskId: dto.targetTaskId,
    });
    const suggestion = this.selectAdvisorSuggestion(analysis.suggestions, dto);

    if (!suggestion) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Advisor remediation did not produce an applicable suggestion.');
    }

    return {
      suggestion,
      suggestions: analysis.suggestions,
      expectedDefinitionRevision: flow.definitionRevision ?? 0,
      intent,
    };
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

  private buildRemediationIntent(dto: PreviewAdvisorRemediationDto, targetNode: any | null): string {
    const findings = dto.items
      .map((item) => `- [${item.category}] ${item.description.trim()}`)
      .join('\n');

    if (dto.mode === 'optimize-step') {
      return [
        `Optimize only the selected step "${targetNode?.label || dto.targetTaskId}" based on these advisor findings.`,
        'Return exactly one single_change suggestion with operationType "update_node" and targetTaskId equal to the selected task id.',
        'Do not create, delete, reorder, or reconnect nodes. Do not modify unrelated steps, edges, ports, or data bindings unless strictly required to keep this selected step valid.',
        'Prefer updating the selected task description. Preserve the existing title unless the findings explicitly require a title change.',
        '',
        'Current selected step:',
        JSON.stringify({
          id: targetNode?.id || dto.targetTaskId,
          title: targetNode?.label || '',
          description: targetNode?.description || targetNode?.metadata?.description || '',
        }, null, 2),
        '',
        'Advisor findings:',
        findings,
      ].join('\n');
    }

    return [
      dto.mode === 'generate-new'
        ? 'Plan a broader optimization of the current playbook based on these structured advisor findings.'
        : 'Optimize the current playbook based on these structured advisor findings.',
      'Return a valid PlaybookIntentSuggestion. Preserve the user\'s original intent and keep the workflow valid.',
      '',
      'Advisor findings:',
      findings,
    ].join('\n');
  }

  private selectAdvisorSuggestion(
    suggestions: PlaybookFlowIntentResponse['suggestions'],
    dto: PreviewAdvisorRemediationDto,
  ): PlaybookFlowIntentResponse['suggestions'][number] | null {
    const ranked = suggestions
      .filter((suggestion) => !suggestion.isDirectIntentFallback)
      .sort((left, right) => right.confidence - left.confidence);
    if (dto.mode !== 'optimize-step') {
      return ranked[0] || null;
    }

    return ranked.find((suggestion) => suggestion.kind === 'single_change'
      && suggestion.operationType === 'update_node'
      && suggestion.targetTaskId === dto.targetTaskId) || null;
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
