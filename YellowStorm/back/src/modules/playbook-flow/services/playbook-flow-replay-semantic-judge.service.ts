import { Injectable, Optional } from '@nestjs/common';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowAdvisorModelService } from './advisor/playbook-flow-advisor-model.service';
import type { FlowTaskSemanticMatch, FlowTaskSemanticFinding } from '../schemas/playbook-flow-task-result.schema';
import type { ReplayPlanningSummary } from '../interfaces/playbook-flow-replay-plan.interface';

type FindingSeverity = FlowTaskSemanticFinding['severity'];

interface JudgeChecklistItem {
  key: string;
  description: string;
  severity: string;
  variables: string[];
  source: string;
}

interface JudgeFinding {
  key: string;
  expected: string;
  observed: string | null;
  severity: FindingSeverity;
}

interface JudgeOutput {
  preservedPoints: string[];
  missingPoints: string[];
  changedPoints: string[];
  missingPointFindings: JudgeFinding[];
  staleContextReferenceFindings: JudgeFinding[];
  unsupportedClaimFindings: JudgeFinding[];
  overallScore: number;
  reason: string;
}

@Injectable()
export class PlaybookFlowReplaySemanticJudgeService {
  constructor(
    @Optional() private readonly liteLLMConnectionService: LiteLLMConnectionService | null,
    @Optional() private readonly modelService: PlaybookFlowAdvisorModelService | null,
    @Optional() private readonly logger: LoggerService | null,
  ) {
    this.logger?.setContext?.(PlaybookFlowReplaySemanticJudgeService.name);
  }

  async evaluate(params: {
    output: string;
    planning: ReplayPlanningSummary;
    contextMappingJson: string;
  }): Promise<FlowTaskSemanticMatch | null> {
    if (!this.liteLLMConnectionService || !this.modelService) {
      return null;
    }

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      this.logger?.warn?.('LiteLLM unavailable for replay semantic judge; will use deterministic fallback.');
      return null;
    }

    try {
      const model = await this.modelService.resolveEvaluationModel('llm');
      const checklist = params.planning.executionPlan.semanticChecklist;
      const judgeResult = await this.callJudge(httpClient, model, params.output, checklist, params.contextMappingJson);

      return {
        matchScore: judgeResult.overallScore,
        semanticSimilarityScore: judgeResult.overallScore,
        evidenceConsistencyScore: judgeResult.overallScore,
        judgeScore: judgeResult.overallScore,
        reason: judgeResult.reason,
        missingPoints: judgeResult.missingPoints,
        changedPoints: judgeResult.changedPoints,
        preservedPoints: judgeResult.preservedPoints,
        missingPointFindings: judgeResult.missingPointFindings,
        changedPointFindings: [],
        extraPointFindings: [],
        staleContextReferenceFindings: judgeResult.staleContextReferenceFindings,
        unsupportedClaimFindings: judgeResult.unsupportedClaimFindings,
        model,
        judgeUsed: true,
        evaluationSource: 'instantiated_replay',
      };
    } catch (error) {
      this.logger?.warn?.(`Replay semantic judge failed: ${(error as Error).message}; will use deterministic fallback.`);
      return null;
    }
  }

  private async callJudge(
    httpClient: NonNullable<ReturnType<LiteLLMConnectionService['getHttpClient']>>,
    model: string,
    output: string,
    checklist: JudgeChecklistItem[],
    contextMappingJson: string,
  ): Promise<JudgeOutput> {
    const checklistJson = JSON.stringify(checklist, null, 2);
    const truncatedOutput = output.length > 8000 ? output.slice(0, 8000) : output;

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a replay semantic preservation judge. Compare a replay execution output against an instantiated semantic checklist derived from a baseline run. Return strict JSON only.`,
        },
        {
          role: 'user',
          content: `## Replay Output
${truncatedOutput}

## Instantiated Semantic Checklist
Each item has a key, description (what should be present), severity, and source.
${checklistJson}

## Context Mapping (baseline vs current values)
${contextMappingJson}

## Instructions
For each checklist item, determine if the replay output preserves it.
- preservedPoints: keys of items fully present in the output
- missingPoints: keys of items absent or violated
- changedPoints: keys where output uses stale baseline context instead of current context values
- overallScore: 0-100 preservation score (100 = all items preserved, no stale references)
- reason: one-sentence summary

Return strict JSON with these fields:
{
  "preservedPoints": ["key1", "key2"],
  "missingPoints": ["key3"],
  "changedPoints": ["key4"],
  "missingPointFindings": [{ "key": "key3", "expected": "description", "observed": null, "severity": "warning" }],
  "staleContextReferenceFindings": [{ "key": "key4", "expected": "current value", "observed": "baseline value", "severity": "fail" }],
  "unsupportedClaimFindings": [],
  "overallScore": 85,
  "reason": "Summary sentence."
}`,
        },
      ],
    }, { timeout: 30000 });

    const content = (response.data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Replay semantic judge returned no content.');
    }

    return this.parseJudgeOutput(content.trim());
  }

  private parseJudgeOutput(raw: string): JudgeOutput {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Replay semantic judge returned invalid JSON.');
    }

    const asStrings = (val: unknown): string[] => {
      if (Array.isArray(val)) return val.map((v) => String(v)).filter(Boolean);
      return [];
    };
    const asFindings = (val: unknown): JudgeFinding[] => {
      if (!Array.isArray(val)) return [];
      const validSeverities: FindingSeverity[] = ['info', 'warning', 'fail'];
      return val.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null).map((v) => {
        const raw = String(v.severity ?? 'info');
        const severity: FindingSeverity = validSeverities.includes(raw as FindingSeverity) ? (raw as FindingSeverity) : 'info';
        return {
          key: String(v.key ?? ''),
          expected: String(v.expected ?? ''),
          observed: v.observed == null ? null : String(v.observed),
          severity,
        };
      });
    };

    const overallScore = typeof parsed.overallScore === 'number'
      ? Math.max(0, Math.min(100, Math.round(parsed.overallScore)))
      : 50;

    return {
      preservedPoints: asStrings(parsed.preservedPoints),
      missingPoints: asStrings(parsed.missingPoints),
      changedPoints: asStrings(parsed.changedPoints),
      missingPointFindings: asFindings(parsed.missingPointFindings),
      staleContextReferenceFindings: asFindings(parsed.staleContextReferenceFindings),
      unsupportedClaimFindings: asFindings(parsed.unsupportedClaimFindings),
      overallScore,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'LLM replay semantic judge evaluation.',
    };
  }
}
