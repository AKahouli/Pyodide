export interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface AttributedTokenUsage extends NormalizedTokenUsage {
  model: string;
  agentId?: string;
}

export interface ConversationUsageAttribution {
  executionId: string;
  entries: AttributedTokenUsage[];
}

export interface ConversationUsageEventInput extends AttributedTokenUsage {
  eventKey: string;
  conversationId: string;
  messageId: string;
  executionId: string;
  provider?: string;
  costUsd: number | null;
  pricingVersion: string | null;
  carbonGramsCo2e: number | null;
  carbonMethodology: string | null;
  carbonFactorVersion: string | null;
}

export interface ConversationUsageMetrics {
  tokens: {
    input: number;
    output: number;
    cachedInput: number;
    reasoning: number;
    total: number;
  };
  cost: { usd: number | null; complete: boolean; pricingVersions?: string[] };
  carbon: {
    gramsCo2e: number | null;
    estimated: true;
    complete: boolean;
    methodologies?: string[];
    factorVersions?: string[];
  };
}

export function normalizeTokenUsage(input: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number; totalTokens?: number }): NormalizedTokenUsage {
  const inputTokens = tokenCount(input.inputTokens);
  const outputTokens = tokenCount(input.outputTokens);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: Math.min(inputTokens, tokenCount(input.cachedInputTokens)),
    reasoningTokens: Math.min(outputTokens, tokenCount(input.reasoningTokens)),
    totalTokens: Math.max(inputTokens + outputTokens, tokenCount(input.totalTokens)),
  };
}

function tokenCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value!)) : 0;
}
