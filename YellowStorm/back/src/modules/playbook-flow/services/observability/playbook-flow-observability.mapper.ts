import {
  FlowCompletedResultPayload,
  FlowLlmPromptTraceItem,
  FlowSemanticMatchSummary,
  FlowToolTraceItem,
  FlowUsageSummary,
} from '../../interfaces/playbook-flow-observability.interface';

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

export function mapToolTrace(value: unknown): FlowToolTraceItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<FlowToolTraceItem[]>((items, entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return items;
    }
    const record = entry as Record<string, unknown>;
    const toolName = toStringValue(record.tool_name ?? record.toolName);
    if (!toolName) {
      return items;
    }

    const status = toStringValue(record.status);
    items.push({
      callIndex: toNumberValue(record.call_index ?? record.callIndex) ?? index,
      toolName,
      args: record.args && typeof record.args === 'object' && !Array.isArray(record.args)
        ? record.args as Record<string, unknown>
        : {},
      outputSummary: toStringValue(record.output_summary ?? record.outputSummary) ?? null,
      status: status === 'completed' || status === 'failed' || status === 'skipped' ? status : undefined,
      durationMs: toNumberValue(record.duration_ms ?? record.durationMs) ?? null,
      error: toStringValue(record.error) ?? null,
    });
    return items;
  }, []);
}

export function mapPromptTrace(value: unknown): FlowLlmPromptTraceItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<FlowLlmPromptTraceItem[]>((items, entry) => {
    if (!entry || typeof entry !== 'object') {
      return items;
    }
    const record = entry as Record<string, unknown>;
    const stage = toStringValue(record.stage);
    const model = toStringValue(record.model);
    const prompt = toStringValue(record.prompt);
    if (!stage || !model || !prompt) {
      return items;
    }
    items.push({ stage, model, prompt });
    return items;
  }, []);
}

export function mapUsage(value: unknown): FlowUsageSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const usage: FlowUsageSummary = {
    inputTokens: toNumberValue(record.input_tokens ?? record.inputTokens) ?? null,
    outputTokens: toNumberValue(record.output_tokens ?? record.outputTokens) ?? null,
    totalTokens: toNumberValue(record.total_tokens ?? record.totalTokens) ?? null,
    model: toStringValue(record.model) ?? null,
  };

  return usage.inputTokens == null
    && usage.outputTokens == null
    && usage.totalTokens == null
    && usage.model == null
    ? null
    : usage;
}

export function mapSemanticMatch(value: unknown): FlowSemanticMatchSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const semanticMatch: FlowSemanticMatchSummary = {
    matchScore: toNumberValue(record.match_score ?? record.matchScore),
    semanticSimilarityScore: toNumberValue(record.semantic_similarity_score ?? record.semanticSimilarityScore),
    evidenceConsistencyScore: toNumberValue(record.evidence_consistency_score ?? record.evidenceConsistencyScore),
    judgeScore: toNumberValue(record.judge_score ?? record.judgeScore),
    reason: toStringValue(record.reason),
    missingPoints: toStringArray(record.missing_points ?? record.missingPoints),
    changedPoints: toStringArray(record.changed_points ?? record.changedPoints),
    model: toStringValue(record.model),
    judgeUsed: typeof record.judge_used === 'boolean'
      ? record.judge_used
      : typeof record.judgeUsed === 'boolean'
        ? record.judgeUsed
        : undefined,
  };

  return Object.values(semanticMatch).every((entry) => entry == null || (Array.isArray(entry) && entry.length === 0))
    ? null
    : semanticMatch;
}

export function mapTraceMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function flattenUsage(payload: Pick<FlowCompletedResultPayload, 'usage'>) {
  return {
    inputTokens: payload.usage?.inputTokens ?? null,
    outputTokens: payload.usage?.outputTokens ?? null,
    totalTokens: payload.usage?.totalTokens ?? null,
    modelName: payload.usage?.model ?? null,
  };
}
