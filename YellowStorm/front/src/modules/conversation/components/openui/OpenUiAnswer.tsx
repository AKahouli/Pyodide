import { lazy, Suspense, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionEvent } from '@openuidev/react-lang';
import { AIMessageContent, type CitationData } from '@/components/ai-elements/ai-message-content';
import { useConversationStore } from '../../store';
import { toFollowUpMessage } from './actions';
import { OpenUiBoundary } from './OpenUiBoundary';
import { loadOpenUiRenderer } from './preload';

/**
 * `lazy()` caches a rejected import for good, so a failed chunk load gets one immediate retry
 * and then a fresh lazy component for the next mount (read at render time through the variable).
 */
let OpenUiRenderer = createLazyRenderer();
function createLazyRenderer() {
  return lazy(() => loadOpenUiRenderer().catch(() => loadOpenUiRenderer()).catch((error: unknown) => {
    OpenUiRenderer = createLazyRenderer();
    throw error;
  }));
}

const spinner = <Loader2 className='size-4 animate-spin text-muted-foreground motion-reduce:animate-none' aria-hidden='true' />;

interface OpenUiAnswerProps {
  content: string;
  isStreaming: boolean;
  conversationId: string;
  messageId: string;
  citations?: CitationData[];
  /** Id of the stored text component this answer renders; ties the rendered DOM back to it for copy/export. */
  partId?: string;
}

/**
 * Renders one assistant text as OpenUI Lang. Anything that goes wrong while
 * loading or rendering falls back to the regular markdown renderer, so the
 * user still reads the answer.
 */
export function OpenUiAnswer({ content, isStreaming, conversationId, messageId, citations, partId }: Readonly<OpenUiAnswerProps>) {
  const handleAction = useCallback((event: ActionEvent) => {
    const followUp = toFollowUpMessage(event);
    if (followUp.kind === 'open-url') {
      window.open(followUp.url, '_blank', 'noopener,noreferrer');
    } else if (followUp.kind === 'message') {
      void useConversationStore.getState().sendMessage(conversationId, { content: followUp.content });
    }
  }, [conversationId]);

  const citationScope = useMemo(() => ({ conversationId, messageId }), [conversationId, messageId]);
  const markdown = (
    <AIMessageContent
      parts={[{ type: 'text', content, showCursor: isStreaming, citations }]}
      isStreaming={isStreaming}
      citationScope={citationScope}
    />
  );
  // A crash on half-parsed streaming content is expected and temporary: show the spinner, never the raw
  // program, and try again on the next chunk. Only a COMPLETE program that still crashes shows markdown.
  return (
    <OpenUiBoundary resetKey={`${isStreaming}|${content}`} fallback={() => (isStreaming ? spinner : <div data-openui-fallback={partId ?? ''}>{markdown}</div>)}>
      <Suspense fallback={spinner}>
        <OpenUiRenderer content={content} isStreaming={isStreaming} onAction={handleAction} citations={citations} citationScope={citationScope} fallback={markdown} partId={partId} />
      </Suspense>
    </OpenUiBoundary>
  );
}
