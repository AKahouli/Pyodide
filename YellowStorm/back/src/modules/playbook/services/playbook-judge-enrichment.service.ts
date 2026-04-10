import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { LiteLLMConnectionService } from '../../models/litellm-connection.service';
import { ModelsService } from '../../models/models.service';
import { UsageService } from '../../usage/usage.service';
import { UsageType } from '../../usage/schemas/usage.schema';
import { PlaybookExecution, PlaybookExecutionDocument, StepStatus, JudgeStatus } from '../schemas/playbook-execution.schema';
import { PlaybookService } from './playbook.service';
import { PlaybookPromptService } from './playbook-prompt.service';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';
import { pLimit } from '../utils/execution.utils';

type JudgeRecommendation = 'none' | 'update_current_playbook' | 'generate_new_optimized_playbook';

const NODE_JUDGE_TIMEOUT_MS = 60000;
const EXECUTION_SUMMARY_TIMEOUT_MS = 60000;
const PLAYBOOK_REWRITE_TIMEOUT_MS = 200000;

interface NodeJudgeResult {
  accuracyScore: number;
  completenessScore: number;
  overallScore: number;
  missingFacts: string[];
  incoherences: string[];
  unsupportedClaims: string[];
  handoffRisks: string[];
  rewriteHints: string[];
  recommendation: JudgeRecommendation;
  reason: string;
  _model?: string;
}

interface ExecutionSummaryResult {
  overallScore: number;
  structuralIssues: string[];
  promptIssues: string[];
  contractIssues: string[];
  handoffIssues: string[];
  recommendation: 'update_current_playbook' | 'generate_new_optimized_playbook';
  reason: string;
  _model?: string;
}

@Injectable()
export class PlaybookJudgeEnrichmentService {
  private readonly runLimited = pLimit(2);

  constructor(
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
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
    const workspaces = Array.isArray(payload.workspaces) && payload.workspaces.length > 0
      ? payload.workspaces
      : (sourcePlaybook.workspaces || []).map((item: any) => item.toString());

    return this.playbookService.createWithTasksAndEdges(
      userId,
      payload.name || `${sourcePlaybook.name} (optimized)`,
      payload.description || sourcePlaybook.description || '',
      tasks,
      edges,
      workspaces,
    );
  }

  async optimizeStep(userId: string, playbookId: string, executionId: string, taskId: string): Promise<any> {
    const sourcePlaybook = await this.playbookService.findById(playbookId);
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) {
      throw new Error('Execution not found');
    }

    const task = (sourcePlaybook.tasks || []).find((item: any) => item.id === taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const payload = await this.buildStepOptimizationPayload(executionId, taskId);
    const optimizedTask = this.normalizeOptimizedTask(task, payload.task || payload);
    const tasks = (sourcePlaybook.tasks || []).map((item: any) => (item.id === taskId ? optimizedTask : item));

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
    const model = defaultModel?.litellmModel || defaultModel?.id || '';
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
    const model = defaultModel?.litellmModel || defaultModel?.id || '';
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

    const playbookSnapshot = (execution.playbookSnapshot as any) || {};
    const task = (playbookSnapshot.tasks || []).find((candidate: any) => candidate.id === taskId) || null;
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
        model: payload._model || null,
        judgeResult: {
          accuracyScore: payload.accuracyScore,
          completenessScore: payload.completenessScore,
          overallScore: payload.overallScore,
          missingFacts: payload.missingFacts || [],
          incoherences: payload.incoherences || [],
          unsupportedClaims: payload.unsupportedClaims || [],
          handoffRisks: payload.handoffRisks || [],
          rewriteHints: payload.rewriteHints || [],
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
    if (execution.judgeSummaryStatus === 'evaluated') return;

    const playbook = await this.playbookService.findById(execution.playbookId?.toString?.() || String(execution.playbookId || ''));

    const completedTasks = (execution.taskResults || []).filter((item: any) => item.status === StepStatus.COMPLETED);
    if (!completedTasks.length) return;

    if (completedTasks.some((item: any) => item.judgeStatus !== JudgeStatus.EVALUATED && item.judgeStatus !== JudgeStatus.FAILED)) {
      return;
    }

    const nodeFindings = completedTasks.map((item: any) => ({
      taskId: item.taskId,
      taskTitle: item.nodeTitle,
      judgeStatus: item.judgeStatus,
      judgeResult: item.judgeResult,
    }));

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) return;

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.litellmModel || defaultModel?.id || '';
    if (!model) return;

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

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, { timeout: EXECUTION_SUMMARY_TIMEOUT_MS });

    const payload = this.extractJsonPayload(response.data?.choices?.[0]?.message?.content) as ExecutionSummaryResult;
    const judgeSummary = {
      overallScore: Number(payload.overallScore ?? 0),
      structuralIssues: payload.structuralIssues || [],
      promptIssues: payload.promptIssues || [],
      contractIssues: payload.contractIssues || [],
      handoffIssues: payload.handoffIssues || [],
      recommendation: payload.recommendation || 'update_current_playbook',
      reason: payload.reason || '',
    };
    await this.executionModel.updateOne(
      { _id: new Types.ObjectId(executionId) },
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
  }

  private async runNodeJudge(execution: any, task: any, taskResult: any, upstreamContext: Record<string, unknown>): Promise<NodeJudgeResult> {
    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new Error('LiteLLM is not available');
    }

    const playbook = await this.playbookService.findById(execution.playbookId?.toString?.() || String(execution.playbookId || ''));

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.litellmModel || defaultModel?.id || '';
    if (!model) {
      throw new Error('No default model configured');
    }

    const prompt = await this.promptService.findByKey('judge.node_reflection');
    const systemPrompt = prompt?.systemTemplate?.trim() || 'Return strict JSON only.';
    const userPrompt = this.renderTemplate(prompt?.userTemplate || '', {
      taskTitle: task?.title || taskResult.nodeTitle || '',
      taskDescription: task?.description || '',
      workflowGoal: String(playbook.description || ''),
      upstreamContextJson: JSON.stringify(upstreamContext, null, 2),
      taskOutput: String(taskResult.output || ''),
      artifactsJson: JSON.stringify(taskResult.artifacts || [], null, 2),
      toolTraceJson: JSON.stringify(taskResult.toolTrace || [], null, 2),
      promptTraceJson: JSON.stringify(taskResult.llmPromptTrace || [], null, 2),
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

    const payload = this.extractJsonPayload(response.data?.choices?.[0]?.message?.content) as NodeJudgeResult;
    const usage = response.data?.usage;
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

    return { ...payload, _model: payload._model || usage?.model || model };
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
}
