import { Context, ContextCacheUsage, ContextContent, ContextContentBody, ContextContentFooter, ContextContentHeader, ContextInputUsage, ContextOutputUsage, ContextReasoningUsage, ContextTrigger } from '@/components/ai-elements/context';
import { useUsage } from '@/modules/usage';
import { memo } from 'react';

const Usage = memo(function Usage() {
  const { status } = useUsage();
  if (!status) return null;
  const isUnlimited = status?.tokens.isUnlimited || status?.plan.isUnlimited;
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
      {!isUnlimited && <ContextTrigger />}
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
