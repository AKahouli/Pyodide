import { Context, ContextCacheUsage, ContextContent, ContextContentBody, ContextContentFooter, ContextContentHeader, ContextInputUsage, ContextOutputUsage, ContextReasoningUsage, ContextTrigger } from '@/components/ai-elements/context';
import { useUsage } from '@/modules/usage';
import { memo } from 'react';

const Usage = memo(function Usage() {
  const { status } = useUsage();
  if (!status) return null;
  // Check if unlimited: remaining === -1 is the most reliable indicator from backend
  const isUnlimited = status?.tokens.remaining === -1 || status?.tokens.isUnlimited || status?.plan.isUnlimited;
  // Also hide if percentUsed is invalid (negative or > 100)
  const hasValidUsage = status?.tokens.percentUsed >= 0 && status?.tokens.percentUsed <= 100;
  const shouldShowUsage = !isUnlimited && hasValidUsage;
  return (
    <Context
      maxTokens={status?.tokens.limit}
      modelId='openai:gpt-5'
      usage={{
        inputTokens: status?.tokens.input,
        outputTokens: status?.tokens.output,
        totalTokens: status?.tokens.total,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      }}
      usedTokens={status?.tokens.total}>
      {shouldShowUsage && <ContextTrigger />}
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody>
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextReasoningUsage />
          <ContextCacheUsage />
        </ContextContentBody>
        <ContextContentFooter />
      </ContextContent>
    </Context>
  );
});

Usage.displayName = 'Usage';

export default Usage;
