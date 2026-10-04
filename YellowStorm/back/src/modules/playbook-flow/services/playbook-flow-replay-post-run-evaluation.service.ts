import { Injectable, Optional } from '@nestjs/common';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowAdvisorModelService } from './advisor/playbook-flow-advisor-model.service';
import { ReplayRunReportRepository } from '../persistence/replay-run-report.repository';

const VALID_VERDICTS = new Set(['match', 'minor_drift', 'major_drift', 'not_comparable']);
const VALID_ACTIONS = new Set(['accept', 'review', 'reject']);

interface JudgeOutput {
  verdict: string;
  overallScore: number | null;
  semanticMatchScore: number | null;
  outputFormatScore: number | null;
  toolSequenceScore: number | null;
  toolDefinitionScore: number | null;
  reasoningScore: number | null;
  summary: string;
  missingPoints: string[];
  changedPoints: string[];
  preservedPoints: string[];
  recommendedAction: string;
}

interface PostRunEvaluationResult {
  judgeUsed: boolean;
  judgeModel: string | null;
  evaluatedAt: Date;
  verdict: 'match' | 'minor_drift' | 'major_drift' | 'not_comparable';
  overallScore: number | null;
  semanticMatchScore: number | null;
  outputFormatScore: number | null;
  toolSequenceScore: number | null;
  toolDefinitionScore: number | null;
  reasoningScore: number | null;
  summary: string;
  missingPoints: string[];
  changedPoints: string[];
  preservedPoints: string[];
  recommendedAction: 'accept' | 'review' | 'reject';
  rawJudgeResponse: Record<string, unknown> | null;
  failureReason: string | null;
}

@Injectable()
export class PlaybookFlowReplayPostRunEvaluationService {
  constructor(
    private readonly reportRepository: ReplayRunReportRepository,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly modelService: PlaybookFlowAdvisorModelService,
    @Optional() private readonly logger: LoggerService | null,
  ) {
    this.logger?.setContext?.(PlaybookFlowReplayPostRunEvaluationService.name);
  }

  async evaluateCompletedReplayRun(params: {
    executionId: string;
    flowId: string;
    taskId: string;
    iteration: number;
    replayReportId: string;
    baselineOutput: string | null;
    newOutput: string | null;
    baselineReasoningChain: unknown[] | null;
    newReasoningChain: unknown[] | null;
    baselineToolCalls: unknown[] | null;
    newToolCalls: unknown[] | null;
    outputFormatGuide: string | null;
    replayPlanningSummary: string | null;
    taskTitle: string;
    taskDescription: string | null;
    replayMode: string;
  }): Promise<void> {
    const existing = await this.reportRepository.findById(params.replayReportId);
    if (!existing) {
      this.logger?.warn?.(`Replay report not found: ${params.replayReportId}`);
      return;
    }
    if (existing.postRunEvaluation) {
      return;
    }

    let result: PostRunEvaluationResult;

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      result = this.buildNotComparable('LiteLLM HTTP client unavailable');
    } else {
      try {
        const model = await this.modelService.resolveReplayEvaluationModel();
        const judgeOutput = await this.callJudge(httpClient, model, params);
        result = this.normalizeJudgeOutput(judgeOutput, model);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger?.warn?.(`Post-run evaluation judge failed for report ${params.replayReportId}: ${message}`);
        result = this.buildNotComparable(message);
      }
    }

    // A concurrent evaluation of the same report may have finished first: its result is kept.
    await this.reportRepository.setPostRunEvaluationIfAbsent(params.replayReportId, result);
  }

  private buildNotComparable(failureReason: string): PostRunEvaluationResult {
    return {
      judgeUsed: false,
      judgeModel: null,
      evaluatedAt: new Date(),
      verdict: 'not_comparable',
      overallScore: null,
      semanticMatchScore: null,
      outputFormatScore: null,
      toolSequenceScore: null,
      toolDefinitionScore: null,
      reasoningScore: null,
      summary: `Post-run evaluation could not be completed: ${failureReason}`,
      missingPoints: [],
      changedPoints: [],
      preservedPoints: [],
      recommendedAction: 'review',
      rawJudgeResponse: null,
      failureReason,
    };
  }

  private async callJudge(
    httpClient: NonNullable<ReturnType<LiteLLMConnectionService['getHttpClient']>>,
    model: string,
    params: {
      baselineOutput: string | null;
      newOutput: string | null;
      baselineReasoningChain: unknown[] | null;
      newReasoningChain: unknown[] | null;
      baselineToolCalls: unknown[] | null;
      newToolCalls: unknown[] | null;
      outputFormatGuide: string | null;
      replayPlanningSummary: string | null;
      taskTitle: string;
      taskDescription: string | null;
      replayMode: string;
    },
  ): Promise<JudgeOutput> {
    const truncOut = (v: string | null, max = 6000) =>
      v ? (v.length > max ? v.slice(0, max) : v) : '(none)';

    const sections: string[] = [];

    sections.push(`## Task: ${params.taskTitle}`);
    if (params.taskDescription) {
      sections.push(`Description: ${params.taskDescription}`);
    }
    sections.push(`Replay mode: ${params.replayMode}`);
    sections.push('');
    sections.push(`## Baseline Output\n${truncOut(params.baselineOutput)}`);
    sections.push('');
    sections.push(`## New Output\n${truncOut(params.newOutput)}`);

    if (params.baselineReasoningChain?.length) {
      sections.push(`\n## Baseline Reasoning Trace\n${JSON.stringify(params.baselineReasoningChain, null, 2)}`);
    }
    if (params.newReasoningChain?.length) {
      sections.push(`\n## New Reasoning Trace\n${JSON.stringify(params.newReasoningChain, null, 2)}`);
    }
    if (params.baselineToolCalls?.length) {
      sections.push(`\n## Baseline Tool Calls\n${JSON.stringify(params.baselineToolCalls, null, 2)}`);
    }
    if (params.newToolCalls?.length) {
      sections.push(`\n## New Tool Calls\n${JSON.stringify(params.newToolCalls, null, 2)}`);
    }
    if (params.outputFormatGuide) {
      sections.push(`\n## Output Format Guide\n${params.outputFormatGuide}`);
    }
    if (params.replayPlanningSummary) {
      sections.push(`\n## Replay Planning Summary\n${params.replayPlanningSummary}`);
    }

    const userContent = sections.join('\n');

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a replay post-run evaluation judge. Compare a completed replay run against the validated baseline. Return strict JSON only.`,
        },
        {
          role: 'user',
          content: `${userContent}

## Instructions
Compare the new output against the baseline. Evaluate:
1. Semantic match: Does the new output preserve the meaning, the narrative thread, the purpose of the baseline? ; sometime due to recontextualization the output could be different due to a change related to any contextual variable (counrty, year, customer, ...) but should be clearly serving the same purpose ; that should not decrease the semantic match score.
2. Output format: Does the new output follow the same format/structure?
3. Tool sequence: Were the same tools used in a similar order?
4. Tool definition: Did corresponding tool calls use matching arguments — same query text, code snippets, parameter names ; sometime due to recontextualization the exact arguments may not be identical but should be clearly serving the same purpose ; that should not decrease the tool definition score.
5. Reasoning: Is the reasoning approach similar?

Return strict JSON:
{
  "verdict": "match" | "minor_drift" | "major_drift" | "not_comparable",
  "overallScore": 0-100,
  "semanticMatchScore": 0-100 or null,
  "outputFormatScore": 0-100 or null,
  "toolSequenceScore": 0-100 or null,
  "toolDefinitionScore": 0-100 or null,
  "reasoningScore": 0-100 or null,
  "summary": "One concise paragraph.",
  "missingPoints": ["baseline expectation absent from new result"],
  "changedPoints": ["meaningful difference between baseline and new result"],
  "preservedPoints": ["important baseline element preserved in new result"],
  "recommendedAction": "accept" | "review" | "reject"
}`,
        },
      ],
    }, { timeout: 345000 });

    const content = (response.data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Post-run judge returned no content.');
    }

    return this.parseJudgeOutput(content.trim());
  }

  private parseJudgeOutput(raw: string): JudgeOutput {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Post-run judge returned invalid JSON.');
    }

    const asStrings = (val: unknown): string[] => {
      if (Array.isArray(val)) return val.map((v) => String(v)).filter(Boolean);
      return [];
    };

    const clamp = (val: unknown): number | null => {
      if (typeof val !== 'number' || !Number.isFinite(val)) return null;
      return Math.max(0, Math.min(100, Math.round(val)));
    };

    return {
      verdict: typeof parsed.verdict === 'string' ? parsed.verdict : 'not_comparable',
      overallScore: clamp(parsed.overallScore),
      semanticMatchScore: clamp(parsed.semanticMatchScore),
      outputFormatScore: clamp(parsed.outputFormatScore),
      toolSequenceScore: clamp(parsed.toolSequenceScore),
      toolDefinitionScore: clamp(parsed.toolDefinitionScore),
      reasoningScore: clamp(parsed.reasoningScore),
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      missingPoints: asStrings(parsed.missingPoints),
      changedPoints: asStrings(parsed.changedPoints),
      preservedPoints: asStrings(parsed.preservedPoints),
      recommendedAction: typeof parsed.recommendedAction === 'string' ? parsed.recommendedAction : 'review',
    };
  }

  private normalizeJudgeOutput(raw: JudgeOutput, model: string): PostRunEvaluationResult {
    const verdict = VALID_VERDICTS.has(raw.verdict) ? raw.verdict as PostRunEvaluationResult['verdict'] : 'not_comparable';
    const recommendedAction = VALID_ACTIONS.has(raw.recommendedAction) ? raw.recommendedAction as PostRunEvaluationResult['recommendedAction'] : 'review';

    return {
      judgeUsed: true,
      judgeModel: model,
      evaluatedAt: new Date(),
      verdict,
      overallScore: raw.overallScore,
      semanticMatchScore: raw.semanticMatchScore,
      outputFormatScore: raw.outputFormatScore,
      toolSequenceScore: raw.toolSequenceScore,
      toolDefinitionScore: raw.toolDefinitionScore,
      reasoningScore: raw.reasoningScore,
      summary: raw.summary || 'Post-run evaluation completed.',
      missingPoints: raw.missingPoints,
      changedPoints: raw.changedPoints,
      preservedPoints: raw.preservedPoints,
      recommendedAction,
      rawJudgeResponse: raw as unknown as Record<string, unknown>,
      failureReason: null,
    };
  }
}
