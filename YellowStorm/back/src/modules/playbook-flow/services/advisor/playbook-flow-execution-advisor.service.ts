import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  BadRequestException,
  NotFoundException,
} from '@modules/exceptions/exceptions/http.exceptions';
import { ExecutionRepository } from '../../persistence/execution.repository';
import { OutputFormatRepository } from '../../persistence/output-format.repository';
import { TaskResultRepository, type TaskResultRecord } from '../../persistence/task-result.repository';
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
import type { AdvisorScoringMode, FlowNode } from '../../models/playbook-flow.model';

export interface AdvisorRemediationPreviewResponse {
  suggestion: PlaybookFlowIntentResponse['suggestions'][number];
  suggestions: PlaybookFlowIntentResponse['suggestions'];
  expectedDefinitionRevision: number;
  intent: string;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

const FALLBACK_STEP_FINDING = 'No specific advisor findings were selected. Improve this selected task so future executions are more deterministic, robust, and aligned with the expected output.';

@Injectable()
export class PlaybookFlowExecutionAdvisorService {
  private readonly logger = new Logger(PlaybookFlowExecutionAdvisorService.name);

  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly taskResultRepository: TaskResultRepository,
    private readonly outputFormatRepository: OutputFormatRepository,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    private readonly mapper: PlaybookFlowExecutionAdvisorMapper,
    private readonly heuristicEvaluator: PlaybookFlowHeuristicAdvisorEvaluatorService,
    private readonly llmEvaluator: PlaybookFlowLlmAdvisorEvaluatorService,
    @Inject(forwardRef(() => PlaybookFlowService))
    private readonly flowService: PlaybookFlowService,
    private readonly intentService: PlaybookFlowIntentService,
  ) {}

  async getRemediations(executionId: string, ownerId: string, taskId?: string): Promise<AdvisorRemediationItem[]> {
    const execution = await this.executionRepository.findById(executionId);
    if (!execution || String(execution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    }

    const taskResults = await this.taskResultRepository.listForExecution(executionId, {
      ...(taskId ? { taskIds: [taskId] } : {}),
      light: true,
      with: ['judgeResult'],
    });
    const items: AdvisorRemediationItem[] = [];

    for (const tr of taskResults) {
      const judgeResult = tr.judgeResult as unknown as FlowExecutionJudgeResult | null | undefined;
      if (!judgeResult) continue;

      const scope = taskId ? 'task' as const : 'playbook' as const;
      const targetTaskId = taskId ?? null;

      const fieldMappings: { key: keyof FlowExecutionJudgeResult; category: AdvisorRemediationCategory; defaultSelected: boolean; blocking: boolean }[] = [
        { key: 'missingFacts', category: 'structure', defaultSelected: true, blocking: false },
        { key: 'incoherences', category: 'prompt', defaultSelected: true, blocking: false },
        { key: 'unsupportedClaims', category: 'evidence', defaultSelected: true, blocking: true },
        { key: 'handoffRisks', category: 'handoff', defaultSelected: true, blocking: true },
        { key: 'toolSelectionIssues', category: 'tooling', defaultSelected: true, blocking: false },
        { key: 'missingToolCalls', category: 'tooling', defaultSelected: true, blocking: true },
        { key: 'redundantToolCalls', category: 'tooling', defaultSelected: false, blocking: false },
        { key: 'toolOutputUseIssues', category: 'evidence', defaultSelected: true, blocking: true },
        { key: 'toolSequencingIssues', category: 'tooling', defaultSelected: true, blocking: false },
        { key: 'toolUsageStrengths', category: 'evidence', defaultSelected: false, blocking: false },
        { key: 'rewriteHints', category: 'determinism', defaultSelected: true, blocking: false },
        { key: 'costOptimizationHints', category: 'cost_efficiency', defaultSelected: true, blocking: false },
        { key: 'scriptReplacementHints', category: 'cost_efficiency', defaultSelected: false, blocking: false },
        { key: 'llmStillRequiredReasons', category: 'cost_efficiency', defaultSelected: false, blocking: false },
      ];

      for (const { key, category, defaultSelected, blocking } of fieldMappings) {
        const entries = judgeResult[key];
        if (!Array.isArray(entries)) continue;
        entries.forEach((description: string, index: number) => {
          const severity = category === 'cost_efficiency' && judgeResult.costOptimizationPriority >= 80
            ? 'high'
            : category === 'cost_efficiency' && judgeResult.costOptimizationPriority >= 50
              ? 'medium'
              : blocking
                ? 'high'
                : defaultSelected
                  ? 'medium'
                  : 'low';
          const suggestedAction = key === 'scriptReplacementHints'
            ? 'replace_with_deterministic_script'
            : category === 'cost_efficiency'
              ? 'optimize_prompt_cost'
              : category === 'tooling'
                ? 'improve_tooling'
                : category === 'handoff'
                  ? 'optimize_playbook'
                  : 'optimize_step';
          items.push({
            id: `${tr.taskId}-${category}-${index}`,
            category,
            scope,
            targetTaskId,
            title: description.length > 80 ? description.slice(0, 80) + '...' : description,
            description,
            rationale: undefined,
            severity,
            confidence: 0.8,
            suggestedAction,
            blocking,
            editable: true,
            defaultSelected,
            source: { kind: 'judge_result', field: String(key), index },
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
    const execution = await this.executionRepository.findById(dto.executionId);
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
    const selection = this.selectAdvisorSuggestion(analysis.suggestions, dto);

    if (!selection.suggestion) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Advisor remediation did not produce an applicable suggestion.');
    }

    return {
      suggestion: selection.suggestion,
      suggestions: analysis.suggestions,
      expectedDefinitionRevision: flow.definitionRevision ?? 0,
      intent,
      validation: selection.validation,
    };
  }

  async runTaskEvaluation(
    executionId: string,
    taskId: string,
    ownerId: string,
    dto?: RunFlowExecutionAdvisorDto,
  ): Promise<FlowExecutionAdvisorTaskResponse> {
    const execution = await this.executionRepository.findById(executionId, { withSnapshot: true });
    if (!execution || String(execution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    }

    const snapshot = (execution.snapshot ?? null) as { nodes?: FlowNode[] } | null;
    const executionScoringMode = execution.advisorScoringMode === 'heuristic' ? 'heuristic' : 'llm';
    const node = snapshot?.nodes?.find((candidate) => candidate.id === taskId) ?? null;
    if (!node) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND, 'Playbook task not found');
    }

    const taskResult = typeof dto?.iteration === 'number'
      ? await this.taskResultRepository.find({ executionId, taskId, iteration: dto.iteration })
      : await this.taskResultRepository.findLatestForTask(executionId, taskId);
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

    await this.taskResultRepository.updateJudge(taskResult.id, { judgeStatus: 'evaluating', judgeError: null });
    this.streamEvents.emitStepJudgeStarted(ownerId, executionId, taskId, taskResult.iteration, scoringMode);

    const expectedResult = this.resolveExpectedResult(node);
    const outputFormatGuide = await this.loadOutputFormatGuide(execution.flowId, taskId);
    const baselineOutput = null;
    const snapshotRecord = (execution.snapshot ?? null);
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

      // Appended in the same statement as the judge state, so a concurrent evaluation cannot drop it.
      await this.taskResultRepository.pushJudgeHistory(taskResult.id, historyEntry as unknown as Record<string, unknown>, {
        judgeStatus: 'evaluated',
        judgeResult: evaluation.judgeResult as unknown as Record<string, unknown>,
        judgeScoringMode: evaluation.scoringMode,
        judgeError: null,
      });

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
        taskOutput: taskResult.output ?? undefined,
        taskError: taskResult.error ?? undefined,
        judgeStatus: 'evaluated',
        judgeScoringMode: evaluation.scoringMode,
        judgeResult: evaluation.judgeResult,
        judgeError: null,
        judgeHistory: [...existingHistory, historyEntry],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Advisor evaluation failed';
      this.logger.warn(`Advisor evaluation failed for ${executionId}:${taskId}: ${message}`);
      await this.taskResultRepository.updateJudge(taskResult.id, { judgeStatus: 'failed', judgeError: message });

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
        taskOutput: taskResult.output ?? undefined,
        taskError: taskResult.error ?? undefined,
        judgeStatus: 'failed',
        judgeScoringMode: taskResult.judgeScoringMode ?? scoringMode,
        judgeResult: null,
        judgeError: message,
        judgeHistory: existingHistory,
      });
    }
  }

  private resolveExpectedResult(node: FlowNode): string | null {
    const metadata = (node.metadata ?? {});
    const value = metadata.expectedResult;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private buildRemediationIntent(dto: PreviewAdvisorRemediationDto, targetNode: any | null): string {
    const selectedFindings = dto.items.length > 0
      ? dto.items
      : [{ category: 'determinism', description: FALLBACK_STEP_FINDING }];
    const findings = selectedFindings
      .map((item) => `- [${item.category}] ${item.description.trim()}`)
      .join('\n');
    const hasCostFindings = selectedFindings.some((item) => item.category === 'cost_efficiency');

    if (dto.mode === 'optimize-step') {
      return [
        `Optimize only the selected step "${targetNode?.label || dto.targetTaskId}" based on these advisor findings.`,
        'Return exactly one single_change suggestion with operationType "update_node" and targetTaskId equal to the selected task id.',
        'Do not create, delete, reorder, or reconnect nodes. Do not modify unrelated steps, edges, ports, or data bindings unless strictly required to keep this selected step valid.',
        'Prefer updating the selected task description. Preserve the existing title unless the findings explicitly require a title change.',
        'Improve task purpose, required inputs, success criteria, expected result, output contract, evidence grounding, tool-use guidance, handoff readiness, and HITL/clarification rules where relevant.',
        hasCostFindings
          ? 'For cost-efficiency findings, optimize for lower inference cost while preserving output quality: shorten repeated instructions, narrow context, clarify strict output contracts, and add deterministic execution guidance where safe. Do not replace the step with code in this flow.'
          : '',
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
      'Prefer minimal valid changes that improve graph structure, handoffs, output contracts, validation/evaluation steps, HITL checkpoints, tool placement, and data binding compatibility.',
      '',
      'Advisor findings:',
      findings,
    ].join('\n');
  }

  private selectAdvisorSuggestion(
    suggestions: PlaybookFlowIntentResponse['suggestions'],
    dto: PreviewAdvisorRemediationDto,
  ): { suggestion: PlaybookFlowIntentResponse['suggestions'][number] | null; validation: AdvisorRemediationPreviewResponse['validation'] } {
    const ranked = suggestions
      .filter((suggestion) => !suggestion.isDirectIntentFallback)
      .sort((left, right) => right.confidence - left.confidence);
    if (dto.mode !== 'optimize-step') {
      const suggestion = ranked.find((candidate) => candidate.kind === 'workflow_plan') || ranked[0] || null;
      return { suggestion, validation: { valid: Boolean(suggestion), errors: suggestion ? [] : ['No valid playbook-level suggestion was produced.'], warnings: [] } };
    }

    const rejected: string[] = [];
    const suggestion = ranked.find((candidate) => {
      if (candidate.kind !== 'single_change') {
        rejected.push(`${candidate.id}: expected single_change suggestion.`);
        return false;
      }
      if (candidate.operationType !== 'update_node') {
        rejected.push(`${candidate.id}: expected update_node operation.`);
        return false;
      }
      if (candidate.targetTaskId !== dto.targetTaskId) {
        rejected.push(`${candidate.id}: targeted ${candidate.targetTaskId || 'no task'} instead of ${dto.targetTaskId}.`);
        return false;
      }
      return true;
    }) || null;

    return {
      suggestion,
      validation: {
        valid: Boolean(suggestion),
        errors: suggestion ? [] : rejected,
        warnings: [],
      },
    };
  }

  private async loadOutputFormatGuide(flowId: string, taskId: string): Promise<string | null> {
    const template = await this.outputFormatRepository.findActive(flowId, taskId);
    return typeof template?.formatGuide === 'string' && template.formatGuide.trim().length > 0
      ? template.formatGuide
      : null;
  }

  private async evaluateTask(params: {
    executionId: string;
    ownerId: string;
    flowId: string;
    node: FlowNode;
    taskResult: TaskResultRecord;
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

    const [llmResult, heuristicResult] = await Promise.all([
      this.llmEvaluator.evaluate(params),
      this.heuristicEvaluator.evaluate(params).catch(() => null),
    ]);

    if (!heuristicResult) {
      return llmResult;
    }

    const merged = this.mergeCostEfficiencyFields(llmResult.judgeResult, heuristicResult.judgeResult);
    return { ...llmResult, judgeResult: merged };
  }

  private mergeCostEfficiencyFields(
    llm: FlowExecutionJudgeResult,
    heuristic: FlowExecutionJudgeResult,
  ): FlowExecutionJudgeResult {
    const heuristicHasNoCostData = heuristic.costOptimizationPriority === 0
      && heuristic.scriptReplacementHints.length === 0
      && heuristic.costOptimizationHints.length === 0;
    if (heuristicHasNoCostData) {
      return llm;
    }

    const llmIsEmpty = llm.costOptimizationPriority === 0
      && llm.scriptReplacementHints.length === 0
      && llm.costOptimizationHints.length === 0;

    if (!llmIsEmpty) {
      return llm;
    }

    const costActionOverride = heuristic.recommendedAction === 'replace_with_deterministic_script'
      || heuristic.recommendedAction === 'optimize_prompt_cost';

    return {
      ...llm,
      costEfficiencyScore: heuristic.costEfficiencyScore,
      costOptimizationPriority: heuristic.costOptimizationPriority,
      estimatedTokenReductionPct: heuristic.estimatedTokenReductionPct,
      estimatedLatencyReductionPct: heuristic.estimatedLatencyReductionPct,
      costOptimizationHints: heuristic.costOptimizationHints,
      scriptReplacementHints: heuristic.scriptReplacementHints,
      llmStillRequiredReasons: heuristic.llmStillRequiredReasons,
      recommendedAction: costActionOverride
        ? heuristic.recommendedAction
        : llm.recommendedAction,
    };
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
