import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { LiteLLMConnectionService } from '../../models/litellm-connection.service';
import { ModelsService } from '../../models/models.service';
import { UsageService } from '../../usage/usage.service';
import { UsageType } from '../../usage/schemas/usage.schema';
import { PlaybookExecution, PlaybookExecutionDocument, StepStatus, JudgeStatus } from '../schemas/playbook-execution.schema';
import { PlaybookValidatedReplay, PlaybookValidatedReplayDocument, ReplayValidationStatus } from '../schemas/playbook-validated-replay.schema';
import { PlaybookService } from './playbook.service';
import { PlaybookPromptService } from './playbook-prompt.service';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';
import { pLimit } from '../utils/execution.utils';

type JudgeRecommendation = 'none' | 'update_current_playbook' | 'generate_new_optimized_playbook';

export type RemediationCategory = 'structure' | 'prompt' | 'contract' | 'handoff' | 'tooling' | 'evidence' | 'output-format';

export interface AdvisorRemediationItem {
  id: string;
  category: RemediationCategory;
  scope: 'task' | 'playbook';
  targetTaskId: string | null;
  title: string;
  description: string;
  rationale?: string;
  editable: boolean;
  defaultSelected: boolean;
  source: {
    kind: string;
    field: string;
    index: number;
  };
}

const NODE_JUDGE_TIMEOUT_MS = 60000;
const EXECUTION_SUMMARY_TIMEOUT_MS = 60000;
const PLAYBOOK_REWRITE_TIMEOUT_MS = 200000;

interface NodeJudgeResult {
  accuracyScore: number;
  completenessScore: number;
  resultMatchingScore: number;
  overallScore: number;
  confidence: number;
  toolUsageScore: number;
  expectedResultSource: 'node_field' | 'golden_baseline' | 'none';
  expectedResultType: 'exact_value' | 'semantic_description' | 'numeric_presentation' | 'document_generation' | 'baseline_comparison' | 'none';
  expectedResultMatched: boolean;
  expectedResultReason: string;
  missingFacts: string[];
  incoherences: string[];
  unsupportedClaims: string[];
  handoffRisks: string[];
  rewriteHints: string[];
  toolSelectionIssues: string[];
  missingToolCalls: string[];
  redundantToolCalls: string[];
  toolOutputUseIssues: string[];
  toolSequencingIssues: string[];
  toolUsageStrengths: string[];
  toolUsageRecommendation: string;
  safeAutoFixType: 'optimize_step' | 'none';
  recommendation: JudgeRecommendation;
  reason: string;
  _model?: string;
}

interface ExecutionSummaryResult {
  overallScore: number;
  confidence: number;
  structuralIssues: string[];
  promptIssues: string[];
  contractIssues: string[];
  handoffIssues: string[];
  toolUsageIssues: string[];
  crossStepToolPatterns: string[];
  rootCauseTaskIds: string[];
  highImpactRecommendations: string[];
  recommendation: 'update_current_playbook' | 'generate_new_optimized_playbook';
  reason: string;
  _model?: string;
}

interface NormalizedNodeJudgePayload extends NodeJudgeResult {
  _model: string | undefined;
}

interface NormalizedExecutionSummaryPayload extends ExecutionSummaryResult {
  _model: string | undefined;
}

@Injectable()
export class PlaybookJudgeEnrichmentService {
  private readonly runLimited = pLimit(2);

  constructor(
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    @InjectModel(PlaybookValidatedReplay.name)
    private readonly replayModel: Model<PlaybookValidatedReplayDocument>,
    private readonly playbookService: PlaybookService,
    private readonly promptService: PlaybookPromptService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly modelsService: ModelsService,
    private readonly usageService: UsageService,
    private readonly streamGateway: PlaybookStreamGatewayService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookJudgeEnrichmentService');
  }

  schedule(userId: string, executionId: string, taskId: string): void {
    void this.runLimited(async () => {
      this.logger.log('Starting async playbook judge', { executionId, taskId });
      await this.evaluateNodeAndPersist(userId, executionId, taskId);
      await this.evaluateExecutionSummaryIfReady(userId, executionId);
    }).catch((error) => {
      this.logger.warn('Async playbook judge failed', {
        executionId,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }

  scheduleExecutionSweep(userId: string, executionId: string): void {
    void this.runLimited(async () => {
      this.logger.log('Starting async playbook judge sweep', { executionId });
      const execution = await this.executionModel.findById(executionId).lean().exec();
      if (!execution) return;

      const pendingTasks = (execution.taskResults || []).filter((item: any) => {
        return item.status === StepStatus.COMPLETED
          && item.judgeStatus !== JudgeStatus.EVALUATED
          && item.judgeStatus !== JudgeStatus.EVALUATING;
      });

      this.logger.log('Enqueuing pending node judges', { executionId, count: pendingTasks.length });
      for (const taskResult of pendingTasks) {
        this.schedule(userId, executionId, taskResult.taskId);
      }
    }).catch((error) => {
      this.logger.warn('Async playbook judge sweep failed', {
        executionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }

  async evaluateNodeNow(userId: string, executionId: string, taskId: string): Promise<void> {
    await this.evaluateNodeAndPersist(userId, executionId, taskId);
  }

  async evaluateExecutionSummaryNowIfReady(userId: string, executionId: string): Promise<void> {
    await this.evaluateExecutionSummaryIfReady(userId, executionId);
  }

  private async claimExecutionSummaryEvaluation(executionId: string): Promise<boolean> {
    const result = await this.executionModel.updateOne(
      {
        _id: new Types.ObjectId(executionId),
        judgeSummaryStatus: { $in: ['idle', 'failed'] },
      },
      {
        $set: {
          judgeSummaryStatus: 'evaluating',
          updatedAt: new Date(),
        },
      },
    );

    return result.modifiedCount > 0;
  }

  private async resolveExpectedResult(
    playbookId: string,
    task: { id?: string; expectedResult?: string | null } | null,
  ): Promise<{ value: string; source: 'node_field' | 'golden_baseline' | 'none' }> {
    const nodeValue = String(task?.expectedResult || '').trim();
    if (nodeValue) {
      return { value: nodeValue, source: 'node_field' };
    }

    const taskId = String(task?.id || '').trim();
    if (playbookId && taskId) {
      const baseline = await this.replayModel.findOne({
        playbookId: new Types.ObjectId(playbookId),
        taskId,
        status: ReplayValidationStatus.ACTIVE,
      }).sort({ updatedAt: -1, createdAt: -1 }).lean().exec();

      const referenceOutput = String(baseline?.referenceOutput || '').trim();
      if (referenceOutput) {
        return { value: referenceOutput, source: 'golden_baseline' };
      }
    }

    return { value: '', source: 'none' };
  }

  private async failClaimedExecutionSummary(executionId: string): Promise<void> {
    await this.executionModel.updateOne(
      { _id: new Types.ObjectId(executionId), judgeSummaryStatus: 'evaluating' },
      {
        $set: {
          judgeSummaryStatus: 'failed',
          updatedAt: new Date(),
        },
      },
    );
  }

  async applyCurrentPlaybook(userId: string, playbookId: string, executionId: string): Promise<any> {
    const payload = await this.buildRewritePayload('judge.rewrite_current_playbook', executionId);
    return this.playbookService.update(playbookId, {
      name: payload.name || undefined,
      description: payload.description || undefined,
      tasks: payload.tasks || undefined,
      edges: payload.edges || undefined,
    } as any);
  }

  async generateNewPlaybook(userId: string, playbookId: string, executionId: string): Promise<any> {
    const sourcePlaybook = await this.playbookService.findById(playbookId);
    const payload = await this.buildRewritePayload('judge.generate_optimized_playbook', executionId);
    const tasks = this.preserveInputMappings(sourcePlaybook.tasks || [], Array.isArray(payload.tasks) ? payload.tasks : []);
    const edges = Array.isArray(payload.edges) && payload.edges.length > 0 ? payload.edges : sourcePlaybook.edges;
    const workspaces = this.normalizeWorkspaceIds(
      sourcePlaybook.workspaces || [],
      Array.isArray(payload.workspaces) ? payload.workspaces : [],
    );

    return this.playbookService.createWithTasksAndEdges(
      userId,
      payload.name || `${sourcePlaybook.name} (optimized)`,
      payload.description || sourcePlaybook.description || '',
      tasks,
      edges,
      workspaces,
    );
  }

  private normalizeWorkspaceIds(sourceWorkspaces: any[], candidateWorkspaces: any[]): string[] {
    const normalized = candidateWorkspaces
      .map((item) => String(item))
      .filter((item) => Types.ObjectId.isValid(item));

    if (normalized.length > 0) {
      return [...new Set(normalized)];
    }

    return (sourceWorkspaces || [])
      .map((item) => String(item))
      .filter((item) => Types.ObjectId.isValid(item));
  }

  async optimizeStep(userId: string, playbookId: string, executionId: string, taskId: string): Promise<any> {
    const sourcePlaybook = await this.playbookService.findById(playbookId);
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) {
      throw new Error('Execution not found');
    }

    const taskResult = (execution.taskResults || []).find((item: any) => item.taskId === taskId);
    const task = (sourcePlaybook.tasks || []).find((item: any) => item.id === taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const payload = await this.buildStepOptimizationPayload(executionId, taskId);
    const optimizedTask = this.normalizeOptimizedTask(task, payload.task || payload);
    const tasks = (sourcePlaybook.tasks || []).map((item: any) => (item.id === taskId ? optimizedTask : item));

    await this.appendAdvisorOptimizationHistory(executionId, taskId, {
      turn: Math.max(1, Number((taskResult as any)?.advisorTurnCount ?? 1)),
      beforeTask: task as unknown as Record<string, unknown>,
      afterTask: optimizedTask as unknown as Record<string, unknown>,
    });

    return this.playbookService.update(playbookId, { tasks } as any);
  }

  private async buildRewritePayload(promptKey: string, executionId: string): Promise<Record<string, any>> {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) {
      throw new Error('Execution not found');
    }

    const playbook = await this.playbookService.findById(execution.playbookId?.toString?.() || String(execution.playbookId || ''));

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new Error('LiteLLM is not available');
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) {
      throw new Error('No default model configured');
    }

    const prompt = await this.promptService.findByKey(promptKey);
    const systemPrompt = prompt?.systemTemplate?.trim() || 'Return strict JSON only.';
    const userPrompt = this.renderTemplate(prompt?.userTemplate || '', {
      playbookJson: JSON.stringify(execution.playbookSnapshot || playbook || {}, null, 2),
      judgeSummaryJson: JSON.stringify(execution.judgeSummary || {}, null, 2),
    });

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, { timeout: PLAYBOOK_REWRITE_TIMEOUT_MS });

    const parsed = this.extractJsonPayload(response.data?.choices?.[0]?.message?.content);
    const usage = response.data?.usage;
    if (usage) {
      this.usageService.recordUsage({
        userId: String(execution.executedBy || 'playbook-judge'),
        inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
        outputTokens: usage.completion_tokens || usage.output_tokens || 0,
        usageType: UsageType.PLAYBOOK,
        modelName: usage.model || model,
        endpoint: promptKey,
      }).catch((err) => this.logger.warn('Failed to record judge usage', { error: (err as Error).message }));
    }

    return parsed;
  }

  private async buildStepOptimizationPayload(executionId: string, taskId: string): Promise<Record<string, any>> {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) {
      throw new Error('Execution not found');
    }

    const playbook = await this.playbookService.findById(execution.playbookId?.toString?.() || String(execution.playbookId || ''));
    const taskResult = (execution.taskResults || []).find((item: any) => item.taskId === taskId);
    const task = (playbook.tasks || []).find((item: any) => item.id === taskId);

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new Error('LiteLLM is not available');
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) {
      throw new Error('No default model configured');
    }

    const prompt = await this.promptService.findByKey('judge.optimize_step');
    const systemPrompt = prompt?.systemTemplate?.trim() || 'Return strict JSON only.';
    const userPrompt = this.renderTemplate(prompt?.userTemplate || '', {
      playbookJson: JSON.stringify(execution.playbookSnapshot || playbook || {}, null, 2),
      taskJson: JSON.stringify(task || {}, null, 2),
      judgeSummaryJson: JSON.stringify(execution.judgeSummary || {}, null, 2),
      judgeResultJson: JSON.stringify(taskResult?.judgeResult || {}, null, 2),
      upstreamContextJson: JSON.stringify(this.buildUpstreamContext(execution, taskId), null, 2),
    });

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, { timeout: PLAYBOOK_REWRITE_TIMEOUT_MS });

    const parsed = this.extractJsonPayload(response.data?.choices?.[0]?.message?.content);
    const usage = response.data?.usage;
    if (usage) {
      this.usageService.recordUsage({
        userId: String(execution.executedBy || 'playbook-judge'),
        inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
        outputTokens: usage.completion_tokens || usage.output_tokens || 0,
        usageType: UsageType.PLAYBOOK,
        modelName: usage.model || model,
        endpoint: 'judge.optimize_step',
      }).catch((err) => this.logger.warn('Failed to record judge usage', { error: (err as Error).message }));
    }

    return parsed;
  }

  private normalizeOptimizedTask(originalTask: any, candidate: any): any {
    const task = candidate?.task && typeof candidate.task === 'object' ? candidate.task : candidate;
    return {
      ...originalTask,
      ...task,
      id: originalTask.id,
      executionOrder: originalTask.executionOrder,
      positionX: originalTask.positionX,
      positionY: originalTask.positionY,
      inputKeys: originalTask.inputKeys || [],
      outputKey: originalTask.outputKey || '',
      inputPorts: originalTask.inputPorts || [],
      outputPorts: originalTask.outputPorts || [],
      inputFiles: originalTask.inputFiles || [],
    };
  }

  private async appendAdvisorOptimizationHistory(
    executionId: string,
    taskId: string,
    entry: {
      turn: number;
      beforeTask: Record<string, unknown>;
      afterTask: Record<string, unknown>;
    },
  ): Promise<void> {
    const historyEntry = {
      turn: entry.turn,
      createdAt: new Date(),
      changedFields: this.computeTaskChangedFields(entry.beforeTask, entry.afterTask),
      beforeTask: this.pickAdvisorOptimizationTaskFields(entry.beforeTask),
      afterTask: this.pickAdvisorOptimizationTaskFields(entry.afterTask),
    };

    await this.executionModel.updateOne(
      { _id: new Types.ObjectId(executionId), 'taskResults.taskId': taskId },
      {
        $push: {
          'taskResults.$.advisorOptimizationHistory': {
            $each: [historyEntry],
            $slice: -25,
          },
        },
        $set: { updatedAt: new Date() },
      },
    ).exec();
  }

  private pickAdvisorOptimizationTaskFields(task: Record<string, unknown>): Record<string, unknown> {
    const fields = [
      'title',
      'description',
      'assignedAgentId',
      'interruptBefore',
      'interruptAfter',
      'allowClarification',
      'clarificationPrompt',
      'maxClarifications',
      'enabled',
      'notifyOnComplete',
      'notifyEmails',
      'stepReplayMode',
      'taskType',
    ];

    return fields.reduce<Record<string, unknown>>((acc, field) => {
      acc[field] = task?.[field];
      return acc;
    }, {});
  }

  private computeTaskChangedFields(
    beforeTask: Record<string, unknown>,
    afterTask: Record<string, unknown>,
  ): string[] {
    const before = this.pickAdvisorOptimizationTaskFields(beforeTask);
    const after = this.pickAdvisorOptimizationTaskFields(afterTask);

    return Object.keys(after).filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  }

  private async evaluateNodeAndPersist(userId: string, executionId: string, taskId: string): Promise<void> {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) return;

    const playbook = await this.playbookService.findById(execution.playbookId?.toString?.() || String(execution.playbookId || ''));

    const taskResult = (execution.taskResults || []).find((item: any) => item.taskId === taskId);
    if (!taskResult || taskResult.status !== StepStatus.COMPLETED) return;

    const hasJudgeEvidence = Boolean(
      (taskResult.output && String(taskResult.output).trim())
      || (taskResult.components && taskResult.components.length > 0)
      || (taskResult.artifacts && taskResult.artifacts.length > 0)
      || (taskResult.toolTrace && taskResult.toolTrace.length > 0)
      || (taskResult.llmPromptTrace && taskResult.llmPromptTrace.length > 0),
    );
    if (!hasJudgeEvidence) {
      this.logger.log('Skipping node judge because no evidence is available', { executionId, taskId });
      return;
    }

    if (taskResult.judgeStatus === JudgeStatus.EVALUATED) return;

    const task = playbook?.tasks?.find((candidate: any) => candidate.id === taskId) || null;
    const upstreamContext = this.buildUpstreamContext(execution, taskId);

      await this.executionModel.updateOne(
        { _id: new Types.ObjectId(executionId), 'taskResults.taskId': taskId },
        { $set: { 'taskResults.$.judgeStatus': JudgeStatus.EVALUATING, 'taskResults.$.judgeError': null, updatedAt: new Date() } },
      );

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_step_judge_started',
      data: { executionId, taskId, judgeStatus: JudgeStatus.EVALUATING },
    });

    try {
      const payload = await this.runNodeJudge(execution, task, taskResult, upstreamContext);
      const judgeHistoryEntry = {
        id: new Types.ObjectId().toString(),
        createdAt: new Date(),
        attemptNumber: taskResult.attemptNumber ?? null,
        model: payload._model || null,
        judgeResult: {
          accuracyScore: payload.accuracyScore,
          completenessScore: payload.completenessScore,
          resultMatchingScore: payload.resultMatchingScore,
          overallScore: payload.overallScore,
          confidence: payload.confidence,
          toolUsageScore: payload.toolUsageScore,
          expectedResultSource: payload.expectedResultSource,
          expectedResultType: payload.expectedResultType,
          expectedResultMatched: payload.expectedResultMatched,
          expectedResultReason: payload.expectedResultReason,
          missingFacts: payload.missingFacts || [],
          incoherences: payload.incoherences || [],
          unsupportedClaims: payload.unsupportedClaims || [],
          handoffRisks: payload.handoffRisks || [],
          rewriteHints: payload.rewriteHints || [],
          toolSelectionIssues: payload.toolSelectionIssues || [],
          missingToolCalls: payload.missingToolCalls || [],
          redundantToolCalls: payload.redundantToolCalls || [],
          toolOutputUseIssues: payload.toolOutputUseIssues || [],
          toolSequencingIssues: payload.toolSequencingIssues || [],
          toolUsageStrengths: payload.toolUsageStrengths || [],
          toolUsageRecommendation: payload.toolUsageRecommendation || '',
          safeAutoFixType: payload.safeAutoFixType || 'none',
          recommendation: payload.recommendation || 'none',
          reason: payload.reason || '',
        },
      };

      await this.executionModel.updateOne(
        { _id: new Types.ObjectId(executionId), 'taskResults.taskId': taskId },
        {
          $set: {
            'taskResults.$.judgeStatus': JudgeStatus.EVALUATED,
            'taskResults.$.judgeResult': judgeHistoryEntry.judgeResult,
            'taskResults.$.judgeError': null,
            updatedAt: new Date(),
          },
          $push: {
            'taskResults.$.judgeHistory': {
              $each: [judgeHistoryEntry],
              $slice: -25,
            },
          },
        },
      );

      this.streamGateway.sendToUser(userId, {
        type: 'playbook_step_judge_updated',
          data: {
            executionId,
            taskId,
            judgeStatus: JudgeStatus.EVALUATED,
            judgeResult: judgeHistoryEntry.judgeResult,
            judgeError: null,
            judgeHistoryEntry: {
            ...judgeHistoryEntry,
            createdAt: judgeHistoryEntry.createdAt.toISOString(),
          },
        },
      });
      this.logger.log('Completed node judge', { executionId, taskId, overallScore: judgeHistoryEntry.judgeResult.overallScore });
    } catch (error) {
      await this.executionModel.updateOne(
        { _id: new Types.ObjectId(executionId), 'taskResults.taskId': taskId },
        {
          $set: {
            'taskResults.$.judgeStatus': JudgeStatus.FAILED,
            'taskResults.$.judgeError': error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date(),
          },
        },
      );

      this.streamGateway.sendToUser(userId, {
        type: 'playbook_step_judge_updated',
        data: {
          executionId,
          taskId,
          judgeStatus: JudgeStatus.FAILED,
          judgeResult: null,
          judgeError: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      this.logger.warn('Node judge failed', {
        executionId,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async evaluateExecutionSummaryIfReady(userId: string, executionId: string): Promise<void> {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) return;
    if (execution.judgeSummaryStatus === 'evaluated' || execution.judgeSummaryStatus === 'evaluating') return;

    const playbook = await this.playbookService.findById(execution.playbookId?.toString?.() || String(execution.playbookId || ''));

    const completedTasks = (execution.taskResults || []).filter((item: any) => item.status === StepStatus.COMPLETED);
    if (!completedTasks.length) return;

    if (completedTasks.some((item: any) => item.judgeStatus !== JudgeStatus.EVALUATED && item.judgeStatus !== JudgeStatus.FAILED)) {
      return;
    }

    const claimed = await this.claimExecutionSummaryEvaluation(executionId);
    if (!claimed) {
      return;
    }

    const nodeFindings = completedTasks.map((item: any) => ({
      taskId: item.taskId,
      taskTitle: item.nodeTitle,
      judgeStatus: item.judgeStatus,
      judgeResult: item.judgeResult,
      toolTrace: item.toolTrace || [],
      llmPromptTrace: item.llmPromptTrace || [],
    }));

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      await this.failClaimedExecutionSummary(executionId);
      return;
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) {
      await this.failClaimedExecutionSummary(executionId);
      return;
    }

    const prompt = await this.promptService.findByKey('judge.execution_summary');
    const systemPrompt = prompt?.systemTemplate?.trim() || 'Return strict JSON only.';
    const userPrompt = this.renderTemplate(prompt?.userTemplate || '', {
      workflowGoal: String(playbook.description || ''),
      executionSummaryJson: JSON.stringify({
        playbookId: execution.playbookId?.toString?.() || execution.playbookId,
        taskCount: completedTasks.length,
        status: execution.status,
      }, null, 2),
      nodeFindingsJson: JSON.stringify(nodeFindings, null, 2),
    });

    try {
      const response = await httpClient.post('/v1/chat/completions', {
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }, { timeout: EXECUTION_SUMMARY_TIMEOUT_MS });

      const usage = response.data?.usage;
      const payload = this.normalizeExecutionSummaryPayload(
        this.extractJsonPayload(response.data?.choices?.[0]?.message?.content),
        usage?.model || model,
      );
      const judgeSummary = {
        overallScore: payload.overallScore,
        confidence: payload.confidence,
        structuralIssues: payload.structuralIssues || [],
        promptIssues: payload.promptIssues || [],
        contractIssues: payload.contractIssues || [],
        handoffIssues: payload.handoffIssues || [],
        toolUsageIssues: payload.toolUsageIssues || [],
        crossStepToolPatterns: payload.crossStepToolPatterns || [],
        rootCauseTaskIds: payload.rootCauseTaskIds || [],
        highImpactRecommendations: payload.highImpactRecommendations || [],
        recommendation: payload.recommendation || 'update_current_playbook',
        reason: payload.reason || '',
      };
      await this.executionModel.updateOne(
        { _id: new Types.ObjectId(executionId), judgeSummaryStatus: 'evaluating' },
        {
          $set: {
            judgeSummaryStatus: 'evaluated',
            judgeSummary,
            updatedAt: new Date(),
          },
        },
      );

      this.streamGateway.sendToUser(userId, {
        type: 'playbook_judge_summary_updated',
        data: {
          executionId,
          judgeSummary,
        },
      });
      this.logger.log('Completed playbook judge summary', { executionId, overallScore: judgeSummary.overallScore });
    } catch (error) {
      await this.failClaimedExecutionSummary(executionId);
      throw error;
    }
  }

  private sanitizeForPrompt(data: unknown): unknown {
    if (!data || typeof data !== 'object') return data;

    const sensitiveKeys = [
      'password', 'token', 'secret', 'authorization', 'apikey', 'api_key',
      'accessToken', 'refreshToken', 'credentials', 'sessionId', 'cookie', 'set-cookie',
    ];

    const sanitize = (obj: unknown, depth = 0): unknown => {
      if (depth > 5) return '[MAX_DEPTH_EXCEEDED]';
      if (Array.isArray(obj)) {
        return obj.slice(0, 100).map((item) => sanitize(item, depth + 1));
      }
      if (typeof obj !== 'object' || obj === null) return obj;

      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = sanitize(value, depth + 1);
        }
      }
      return result;
    };

    return sanitize(data);
  }

  private async runNodeJudge(execution: any, task: any, taskResult: any, upstreamContext: Record<string, unknown>): Promise<NodeJudgeResult> {
    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new Error('LiteLLM is not available');
    }

    const playbook = await this.playbookService.findById(execution.playbookId?.toString?.() || String(execution.playbookId || ''));
    const expectedResult = await this.resolveExpectedResult(
      execution.playbookId?.toString?.() || String(execution.playbookId || ''),
      task,
    );

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) {
      throw new Error('No default model configured');
    }

    const prompt = await this.promptService.findByKey('judge.node_reflection');
    const systemPrompt = prompt?.systemTemplate?.trim() || 'Return strict JSON only.';
    const userPrompt = this.renderTemplate(prompt?.userTemplate || '', {
      taskTitle: task?.title || taskResult.nodeTitle || '',
      taskDescription: task?.description || '',
      workflowGoal: String(playbook.description || ''),
      expectedResultSource: expectedResult.source,
      expectedResult: expectedResult.value || 'None',
      upstreamContextJson: JSON.stringify(this.sanitizeForPrompt(upstreamContext), null, 2),
      taskOutput: String(taskResult.output || ''),
      artifactsJson: JSON.stringify(this.sanitizeForPrompt(taskResult.artifacts || []), null, 2),
      toolTraceJson: JSON.stringify(this.sanitizeForPrompt(taskResult.toolTrace || []), null, 2),
      promptTraceJson: JSON.stringify(this.sanitizeForPrompt(taskResult.llmPromptTrace || []), null, 2),
    });

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, { timeout: NODE_JUDGE_TIMEOUT_MS });

    const usage = response.data?.usage;
    const payload = this.normalizeNodeJudgePayload(
      this.extractJsonPayload(response.data?.choices?.[0]?.message?.content),
      usage?.model || model,
    );
    if (usage) {
      this.usageService.recordUsage({
        userId: String(execution.executedBy || 'playbook-judge'),
        inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
        outputTokens: usage.completion_tokens || usage.output_tokens || 0,
        usageType: UsageType.PLAYBOOK,
        modelName: usage.model || model,
        endpoint: 'playbook.node-reflection',
      }).catch((err) => this.logger.warn('Failed to record node reflection usage', { error: (err as Error).message }));
    }

    return payload;
  }

  private buildUpstreamContext(execution: any, taskId: string): Record<string, unknown> {
    const snapshot = (execution.playbookSnapshot as any) || {};
    const taskResults = new Map((execution.taskResults || []).map((item: any) => [item.taskId, item as any]));
    const upstreamTaskIds = new Set<string>();

    for (const edge of snapshot.edges || []) {
      const targetId = String(edge.targetId || edge.target_id || '');
      const sourceId = String(edge.sourceId || edge.source_id || '');
      if (targetId === taskId && sourceId) {
        upstreamTaskIds.add(sourceId);
      }
    }

    const upstreamTasks = Array.from(upstreamTaskIds).map((upstreamTaskId) => {
      const result = taskResults.get(upstreamTaskId) as any;
      return {
        taskId: upstreamTaskId,
        output: result?.output || null,
        artifacts: result?.artifacts || [],
        status: result?.status || null,
      };
    });

    return { upstreamTasks };
  }

  private normalizeNodeJudgePayload(payload: unknown, modelName?: string): NormalizedNodeJudgePayload {
    const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};

    // Keep advisor parsing defensive because these prompt contracts evolve often and malformed payloads must degrade safely.
    return {
      accuracyScore: this.normalizeScore(source.accuracyScore),
      completenessScore: this.normalizeScore(source.completenessScore),
      resultMatchingScore: this.normalizeScore(source.resultMatchingScore),
      overallScore: this.normalizeScore(source.overallScore),
      confidence: this.normalizeConfidence(source.confidence),
      toolUsageScore: this.normalizeScore(source.toolUsageScore),
      expectedResultSource: this.normalizeExpectedResultSource(source.expectedResultSource),
      expectedResultType: this.normalizeExpectedResultType(source.expectedResultType),
      expectedResultMatched: source.expectedResultMatched === true,
      expectedResultReason: this.normalizeText(source.expectedResultReason),
      missingFacts: this.normalizeStringList(source.missingFacts),
      incoherences: this.normalizeStringList(source.incoherences),
      unsupportedClaims: this.normalizeStringList(source.unsupportedClaims),
      handoffRisks: this.normalizeStringList(source.handoffRisks),
      rewriteHints: this.normalizeStringList(source.rewriteHints),
      toolSelectionIssues: this.normalizeStringList(source.toolSelectionIssues),
      missingToolCalls: this.normalizeStringList(source.missingToolCalls),
      redundantToolCalls: this.normalizeStringList(source.redundantToolCalls),
      toolOutputUseIssues: this.normalizeStringList(source.toolOutputUseIssues),
      toolSequencingIssues: this.normalizeStringList(source.toolSequencingIssues),
      toolUsageStrengths: this.normalizeStringList(source.toolUsageStrengths),
      toolUsageRecommendation: this.normalizeText(source.toolUsageRecommendation),
      safeAutoFixType: source.safeAutoFixType === 'optimize_step' ? 'optimize_step' : 'none',
      recommendation: this.normalizeNodeRecommendation(source.recommendation),
      reason: this.normalizeText(source.reason),
      _model: this.normalizeText(source._model) || modelName,
    };
  }

  private normalizeExecutionSummaryPayload(payload: unknown, modelName?: string): NormalizedExecutionSummaryPayload {
    const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};

    return {
      overallScore: this.normalizeScore(source.overallScore),
      confidence: this.normalizeConfidence(source.confidence),
      structuralIssues: this.normalizeStringList(source.structuralIssues),
      promptIssues: this.normalizeStringList(source.promptIssues),
      contractIssues: this.normalizeStringList(source.contractIssues),
      handoffIssues: this.normalizeStringList(source.handoffIssues),
      toolUsageIssues: this.normalizeStringList(source.toolUsageIssues),
      crossStepToolPatterns: this.normalizeStringList(source.crossStepToolPatterns),
      rootCauseTaskIds: this.normalizeStringList(source.rootCauseTaskIds),
      highImpactRecommendations: this.normalizeStringList(source.highImpactRecommendations),
      recommendation: this.normalizeExecutionRecommendation(source.recommendation),
      reason: this.normalizeText(source.reason),
      _model: this.normalizeText(source._model) || modelName,
    };
  }

  private normalizeScore(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, parsed));
  }

  private normalizeConfidence(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return 0;
    if (parsed <= 1) {
      return Math.max(0, Math.min(1, parsed));
    }
    return Math.max(0, Math.min(1, parsed / 100));
  }

  private normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.normalizeText(item))
      .filter((item) => item.length > 0);
  }

  private normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeNodeRecommendation(value: unknown): JudgeRecommendation {
    return value === 'update_current_playbook' || value === 'generate_new_optimized_playbook' || value === 'none'
      ? value
      : 'none';
  }

  private normalizeExpectedResultSource(value: unknown): 'node_field' | 'golden_baseline' | 'none' {
    return value === 'node_field' || value === 'golden_baseline' || value === 'none'
      ? value
      : 'none';
  }

  private normalizeExpectedResultType(
    value: unknown,
  ): 'exact_value' | 'semantic_description' | 'numeric_presentation' | 'document_generation' | 'baseline_comparison' | 'none' {
    return value === 'exact_value'
      || value === 'semantic_description'
      || value === 'numeric_presentation'
      || value === 'document_generation'
      || value === 'baseline_comparison'
      || value === 'none'
      ? value
      : 'none';
  }

  private normalizeExecutionRecommendation(value: unknown): 'update_current_playbook' | 'generate_new_optimized_playbook' {
    return value === 'generate_new_optimized_playbook' ? 'generate_new_optimized_playbook' : 'update_current_playbook';
  }

  private preserveInputMappings(originalTasks: any[], rewrittenTasks: any[]): any[] {
    if (!Array.isArray(rewrittenTasks) || rewrittenTasks.length === 0) {
      return originalTasks;
    }

    return rewrittenTasks.map((task: any, index: number) => {
      const original = originalTasks.find((candidate) => candidate.id === task.id) || originalTasks[index] || {};
      return {
        ...original,
        ...task,
        inputFiles: task.inputFiles || original.inputFiles || [],
        inputPorts: task.inputPorts || original.inputPorts || [],
        outputPorts: task.outputPorts || original.outputPorts || [],
        inputFilesByPort: task.inputFilesByPort || original.inputFilesByPort || [],
      };
    });
  }

  private renderTemplate(template: string, data: Record<string, string>): string {
    return Object.entries(data).reduce(
      (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
      template || '',
    );
  }

  private extractJsonPayload(content: unknown): any {
    if (typeof content !== 'string') {
      return content && typeof content === 'object' ? content : {};
    }

    const trimmed = content.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          return {};
        }
      }
      return {};
    }
  }

  async getRemediations(executionId: string, taskId?: string): Promise<AdvisorRemediationItem[]> {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) return [];

    const items: AdvisorRemediationItem[] = [];

    const taskResultsFilter = taskId
      ? (execution.taskResults || []).filter((tr: any) => tr.taskId === taskId)
      : (execution.taskResults || []);

    for (const tr of taskResultsFilter) {
      const jr = tr.judgeResult;
      if (!jr) continue;

      items.push(...this.classifyStringList(jr.rewriteHints, tr.taskId, 'rewriteHints', 'prompt', true));
      items.push(...this.classifyStringList(jr.missingFacts, tr.taskId, 'missingFacts', 'evidence', false));
      items.push(...this.classifyStringList(jr.incoherences, tr.taskId, 'incoherences', 'prompt', false));
      items.push(...this.classifyStringList(jr.unsupportedClaims, tr.taskId, 'unsupportedClaims', 'contract', false));
      items.push(...this.classifyStringList(jr.handoffRisks, tr.taskId, 'handoffRisks', 'handoff', false));
      items.push(...this.classifyStringList(jr.toolSelectionIssues, tr.taskId, 'toolSelectionIssues', 'tooling', false));
      items.push(...this.classifyStringList(jr.missingToolCalls, tr.taskId, 'missingToolCalls', 'tooling', false));
      items.push(...this.classifyStringList(jr.redundantToolCalls, tr.taskId, 'redundantToolCalls', 'tooling', false));
      items.push(...this.classifyStringList(jr.toolOutputUseIssues, tr.taskId, 'toolOutputUseIssues', 'tooling', false));
      items.push(...this.classifyStringList(jr.toolSequencingIssues, tr.taskId, 'toolSequencingIssues', 'tooling', false));
    }

    if (execution.judgeSummary) {
      const js = execution.judgeSummary as any;
      items.push(...this.classifyStringList(js.toolUsageIssues || [], null, 'summary.toolUsageIssues', 'tooling', false, true));
      items.push(...this.classifyStringList(js.crossStepToolPatterns || [], null, 'summary.crossStepToolPatterns', 'structure', false, true));
      items.push(...this.classifyStringList(js.highImpactRecommendations || [], null, 'summary.highImpactRecommendations', 'structure', true, true));
    }

    return items;
  }

  async applyRemediations(
    userId: string,
    playbookId: string,
    executionId: string,
    selectedIds: string[],
    mode: 'update-current' | 'generate-new' = 'update-current',
  ): Promise<any> {
    const allItems = await this.getRemediations(executionId);
    const selected = allItems.filter((item) => selectedIds.includes(item.id));

    if (selected.length === 0) {
      return mode === 'update-current'
        ? this.playbookService.findById(playbookId)
        : null;
    }

    const playbook = await this.playbookService.findById(playbookId);
    if (!playbook) throw new Error('Playbook not found');

    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) throw new Error('Execution not found');

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) throw new Error('LiteLLM is not available');

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) throw new Error('No default model configured');

    const prompt = await this.promptService.findByKey('judge.rewrite_current_playbook');
    const systemPrompt = prompt?.systemTemplate?.trim() || 'Return strict JSON only.';

    const userPrompt = this.renderTemplate(prompt?.userTemplate || '', {
      playbookJson: JSON.stringify(execution.playbookSnapshot || playbook || {}, null, 2),
      judgeSummaryJson: JSON.stringify(execution.judgeSummary || {}, null, 2),
    });

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `${userPrompt}\n\nApply only the following remediation hints (exclude all others):\n${selected.map((item) => `[${item.category.toUpperCase()}] ${item.description}`).join('\n')}`,
        },
      ],
    }, { timeout: PLAYBOOK_REWRITE_TIMEOUT_MS });

    const parsed = this.extractJsonPayload(response.data?.choices?.[0]?.message?.content);
    const usage = response.data?.usage;
    if (usage) {
      this.usageService.recordUsage({
        userId: String(execution.executedBy || 'playbook-judge'),
        inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
        outputTokens: usage.completion_tokens || usage.output_tokens || 0,
        usageType: UsageType.PLAYBOOK,
        modelName: usage.model || model,
        endpoint: 'judge.apply_remediations',
      }).catch((err) => this.logger.warn('Failed to record advisor usage', { error: (err as Error).message }));
    }

    if (mode === 'generate-new') {
      const tasks = this.normalizeWorkspaceIds(
        playbook.workspaces || [],
        Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
      );
      return this.playbookService.createWithTasksAndEdges(
        userId,
        parsed.name || `${playbook.name} (optimized)`,
        parsed.description || playbook.description || '',
        this.preserveInputMappings(playbook.tasks || [], Array.isArray(parsed.tasks) ? parsed.tasks : []),
        Array.isArray(parsed.edges) && parsed.edges.length > 0 ? parsed.edges : playbook.edges,
        tasks,
      );
    }

    return this.playbookService.update(playbookId, {
      name: parsed.name || undefined,
      description: parsed.description || undefined,
      tasks: parsed.tasks || undefined,
      edges: parsed.edges || undefined,
    } as any);
  }

  private classifyStringList(
    items: string[] | undefined | null,
    taskId: string | null,
    field: string,
    defaultCategory: RemediationCategory,
    editable: boolean,
    playbookScope = false,
  ): AdvisorRemediationItem[] {
    if (!Array.isArray(items) || items.length === 0) return [];

    return items.map((text, index) => ({
      id: `${field}:${taskId || 'playbook'}:${index}`,
      category: this.inferCategory(text, defaultCategory),
      scope: playbookScope ? ('playbook' as const) : ('task' as const),
      targetTaskId: taskId,
      title: this.extractTitle(text),
      description: text,
      rationale: undefined,
      editable,
      defaultSelected: editable,
      source: { kind: field, field, index },
    }));
  }

  private inferCategory(text: string, fallback: RemediationCategory): RemediationCategory {
    const lower = text.toLowerCase();
    if (/prompt|instruction|system message|context/i.test(lower)) return 'prompt';
    if (/tool|function|api call|search|retriev/i.test(lower)) return 'tooling';
    if (/contract|output format|schema|structure|json/i.test(lower)) return 'contract';
    if (/handoff|transition|upstream|downstream|edge/i.test(lower)) return 'handoff';
    if (/fact|evidence|source|citation|reference|data/i.test(lower)) return 'evidence';
    if (/format|template|output guide/i.test(lower)) return 'output-format';
    return fallback;
  }

  private extractTitle(text: string): string {
    const maxLen = 80;
    if (text.length <= maxLen) return text;
    const truncated = text.slice(0, maxLen);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > maxLen / 2 ? truncated.slice(0, lastSpace) + '…' : truncated + '…';
  }
}
