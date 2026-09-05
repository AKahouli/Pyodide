import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';
import { LoggerService } from '@modules/logger';
import { UsageService } from '@modules/usage/usage.service';
import { UsageType } from '@modules/usage/schemas/usage.schema';
import { PlaybookFlowPromptRendererService } from '../playbook-flow-prompt-renderer.service';
import { PlaybookFlowPromptTemplateService } from '../playbook-flow-prompt-template.service';
import { PlaybookFlowAdvisorModelService } from './playbook-flow-advisor-model.service';
import { PlaybookFlowExecutionAdvisorMapper } from './playbook-flow-execution-advisor.mapper';
import type { FlowNode } from '../../schemas/playbook-flow.schema';
import type { FlowTaskResultDocument } from '../../schemas/playbook-flow-task-result.schema';
import type {
  FlowExecutionAdvisorEvaluationResult,
  FlowExecutionJudgePromptTraceItem,
  FlowExecutionJudgeUsage,
} from '../../interfaces/playbook-flow-execution-advisor.interface';

const ADVISOR_EVALUATION_PROMPT_KEY = 'judge.node_reflection';
const ADVISOR_EVALUATION_ENDPOINT = 'playbook-flow.advisor-evaluation';

@Injectable()
export class PlaybookFlowLlmAdvisorEvaluatorService {
  constructor(
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly promptTemplateService: PlaybookFlowPromptTemplateService,
    private readonly promptRenderer: PlaybookFlowPromptRendererService,
    private readonly modelService: PlaybookFlowAdvisorModelService,
    private readonly usageService: UsageService,
    private readonly mapper: PlaybookFlowExecutionAdvisorMapper,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaybookFlowLlmAdvisorEvaluatorService.name);
  }

  async evaluate(params: {
    executionId: string;
    ownerId: string;
    flowId: string;
    node: FlowNode;
    taskResult: FlowTaskResultDocument | Record<string, unknown>;
    expectedResult: string | null;
    outputFormatGuide: string | null;
    baselineOutput: string | null;
    workflowGoal: string;
    upstreamContextJson: string;
  }): Promise<FlowExecutionAdvisorEvaluationResult> {
    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR, 'LiteLLM is unavailable.');
    }

    const model = await this.modelService.resolveEvaluationModel('llm');
    const prompt = await this.buildPrompt({ ...params, model });

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: prompt.messages,
    }, { timeout: 345000 });

    const content = this.extractContent(response.data);
    const judgeResult = this.mapper.mapLlmJudgeResult(content);
    const usage = this.extractUsage(response.data, model);
    const llmPromptTrace: FlowExecutionJudgePromptTraceItem[] = [
      {
        stage: 'advisor_evaluation',
        model,
        prompt: prompt.messages.map((message) => `${message.role}: ${message.content}`).join('\n\n'),
      },
    ];

    if ((usage.inputTokens ?? 0) > 0 || (usage.outputTokens ?? 0) > 0) {
      await this.usageService.recordUsage({
        userId: params.ownerId,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        usageType: UsageType.PLAYBOOK,
        modelName: usage.model ?? model,
        endpoint: ADVISOR_EVALUATION_ENDPOINT,
      });
    }

    return {
      judgeResult,
      model,
      scoringMode: 'llm',
      usage,
      llmPromptTrace,
    };
  }

  private async buildPrompt(params: {
    executionId: string;
    flowId: string;
    node: FlowNode;
    taskResult: FlowTaskResultDocument | Record<string, unknown>;
    expectedResult: string | null;
    outputFormatGuide: string | null;
    baselineOutput: string | null;
    workflowGoal: string;
    upstreamContextJson: string;
    model: string;
  }): Promise<{ messages: Array<{ role: 'system' | 'user'; content: string }> }> {
    const promptTemplate = await this.promptTemplateService.findByKey(ADVISOR_EVALUATION_PROMPT_KEY);
    const metadata = (params.node.metadata ?? {}) as Record<string, unknown>;
    const taskOutput = typeof params.taskResult.output === 'string'
      ? params.taskResult.output
      : JSON.stringify(params.taskResult.output ?? null, null, 2);

    const variables = {
      taskTitle: params.node.label || params.node.id,
      taskDescription: params.node.description || String(metadata.description || ''),
      workflowGoal: params.workflowGoal,
      expectedResult: params.expectedResult || params.baselineOutput || params.outputFormatGuide || '',
      upstreamContextJson: params.upstreamContextJson,
      taskOutput,
      artifactsJson: JSON.stringify(params.taskResult.artifacts ?? [], null, 2),
      toolTraceJson: JSON.stringify(params.taskResult.toolTrace ?? [], null, 2),
      promptTraceJson: JSON.stringify(params.taskResult.llmPromptTrace ?? [], null, 2),
      taskExecutionUsageJson: JSON.stringify(params.taskResult.usage ?? null, null, 2),
    };

    const systemTemplate = promptTemplate?.systemTemplate?.trim() || 'You are a strict Playbook Advisor. Return strict JSON only.';
    const userTemplate = promptTemplate?.userTemplate?.trim() || '';

    return {
      messages: [
        { role: 'system', content: this.promptRenderer.render(systemTemplate, variables) },
        { role: 'user', content: this.promptRenderer.render(userTemplate, variables) },
      ],
    };
  }

  private extractContent(responseData: unknown): string {
    const content = (responseData as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR, 'Advisor evaluation returned no content.');
    }

    return content.trim();
  }

  private extractUsage(responseData: unknown, model: string): FlowExecutionJudgeUsage {
    const usage = (responseData as { usage?: Record<string, unknown> })?.usage ?? {};
    const inputTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null;
    const outputTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null;
    const totalTokens = typeof usage.total_tokens === 'number'
      ? usage.total_tokens
      : (inputTokens ?? 0) + (outputTokens ?? 0);

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      model,
    };
  }
}
