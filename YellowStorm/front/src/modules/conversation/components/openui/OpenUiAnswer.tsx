import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionEvent } from '@openuidev/react-lang';
import { AIMessageContent, type CitationData } from '@/components/ai-elements/ai-message-content';
import { useConversationStore } from '../../store';
import { OpenUiSubmissionContext, submissionKey, submissionSignature, toFollowUpMessage } from './actions';
import { OpenUiBoundary } from './OpenUiBoundary';
import { loadOpenUiRenderer } from './preload';
import { downloadArtifactFile, getArtifactDownloadUrl } from '../../api';
import type { ArtifactActivityData, OpenUiSubmission } from '../../types';
import { useModuleTranslation } from '@/modules/localization';
import { showError } from '@/lib/notifications';
import { sanitizeActivityFilename } from '../../utils/tool-activity';

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
  artifacts?: readonly ArtifactActivityData[];
  /** Id of the stored text component this answer renders; ties the rendered DOM back to it for copy/export. */
  partId?: string;
}

/**
 * Renders one assistant text as OpenUI Lang. Anything that goes wrong while
 * loading or rendering falls back to the regular markdown renderer, so the
 * user still reads the answer.
 */
export function OpenUiAnswer(props: Readonly<OpenUiAnswerProps>) {
  return <ScopedOpenUiAnswer key={`${props.conversationId}:${props.messageId}:${props.partId ?? ''}`} {...props} />;
}
function ScopedOpenUiAnswer({ content, isStreaming, conversationId, messageId, citations, artifacts, partId }: Readonly<OpenUiAnswerProps>) {
  const { t } = useModuleTranslation('conversation');
  const messages = useConversationStore(state => state.messages);
  const [localStatus, setLocalStatus] = useState<Record<string, 'submitting' | 'submitted' | 'error'>>({});
  const busy = useRef(false);
  const retries = useRef(new Map<string, string>());
  const accepted = useRef(new Map<string, string>());
  const saved = useMemo(() => messages.filter(message => message.conversationType === 'user' && message.interaction?.type === 'openui'
    && message.interaction.sourceMessageId === messageId && message.interaction.componentId === partId
    && message.conversationId === conversationId && !message.id.startsWith('temp-'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(message => message.interaction as OpenUiSubmission), [messages, messageId, partId, conversationId]);
  const savedStateSignature = submissionSignature(Object.assign({}, ...saved.map(submission => submission.formState)));
  const initialState = useMemo(() => JSON.parse(savedStateSignature) as Record<string, unknown>, [savedStateSignature]);
  const statuses = useMemo(() => ({ ...Object.fromEntries(saved.map(submission => [submissionKey(submission), 'submitted' as const])), ...localStatus }), [saved, localStatus]);
  const handleAction = useCallback((event: ActionEvent) => {
    if (isStreaming) return;
    let followUp: ReturnType<typeof toFollowUpMessage>;
    try { followUp = toFollowUpMessage(event, artifacts); }
    catch { showError(t('openui.interaction.invalid')); return; }
    if (followUp.kind === 'download-artifact') {
      const { artifact } = followUp;
      void getArtifactDownloadUrl(conversationId, messageId, artifact.artifactId)
        .then(({ downloadUrl }) => downloadArtifactFile(downloadUrl, sanitizeActivityFilename(artifact.filename) || t('stream.activity.generated')))
        .catch(() => showError(t('stream.activity.artifactError')));
    } else if (followUp.kind === 'open-url') {
      window.open(followUp.url, '_blank', 'noopener,noreferrer');
    } else if (followUp.kind === 'message') {
      const state = useConversationStore.getState();
      if (busy.current || state.isStreaming || (state.currentConversationId && state.currentConversationId !== conversationId)) return;
      if (!followUp.submission) {
        void state.sendMessage(conversationId, { content: followUp.content }).catch(() => showError(t('openui.interaction.error')));
        return;
      }
      if (!partId) { showError(t('openui.interaction.invalid')); return; }
      const openUiSubmission: OpenUiSubmission = { type: 'openui', schemaVersion: 1, sourceMessageId: messageId, componentId: partId,
        actionType: 'continue_conversation', ...followUp.submission };
      const signature = submissionSignature(openUiSubmission);
      const key = submissionKey(openUiSubmission);
      const lastSaved = saved.filter(submission => submissionKey(submission) === key).at(-1);
      const lastSignature = accepted.current.get(key) ?? (lastSaved ? submissionSignature(lastSaved) : undefined);
      if (lastSignature === signature) return;
      const requestId = retries.current.get(signature) ?? crypto.randomUUID();
      retries.current.set(signature, requestId);
      busy.current = true;
      setLocalStatus(previous => ({ ...previous, [key]: 'submitting' }));
      void state.sendMessage(conversationId, { content: followUp.content, openUiSubmission, requestId, parentMessageId: messageId })
        .then(() => { accepted.current.set(key, signature); retries.current.delete(signature); setLocalStatus(previous => ({ ...previous, [key]: 'submitted' })); })
        .catch(() => setLocalStatus(previous => ({ ...previous, [key]: 'error' })))
        .finally(() => { busy.current = false; });
    }
  }, [conversationId, messageId, partId, artifacts, isStreaming, saved, t]);

  const citationScope = useMemo(() => ({ conversationId, messageId, ...(partId ? { componentId: partId } : {}) }), [conversationId, messageId, partId]);
  const renderMarkdown = (text: string) => (
    <AIMessageContent
      parts={[{ type: 'text', content: text, showCursor: isStreaming, citations }]}
      isStreaming={isStreaming}
      citationScope={citationScope}
    />
  );
  // A crash on half-parsed streaming content is expected and temporary: show the spinner, never the raw
  // program, and try again on the next chunk. Only a COMPLETE program that still crashes shows markdown.
  return (
    <OpenUiBoundary resetKey={`${isStreaming}|${content}`} fallback={() => (isStreaming ? spinner : <div data-openui-fallback={partId ?? ''}>{renderMarkdown(content)}</div>)}>
      <Suspense fallback={spinner}>
        <OpenUiSubmissionContext.Provider value={statuses}>
          <fieldset disabled={Object.values(localStatus).includes('submitting')} className='m-0 min-w-0 border-0 p-0'>
            <OpenUiRenderer content={content} isStreaming={isStreaming} onAction={handleAction} citations={citations} citationScope={citationScope} fallback={renderMarkdown} partId={partId} initialState={initialState} />
          </fieldset>
          {Object.values(localStatus).includes('error') && <p role='alert' className='mt-2 text-sm text-destructive'>{t('openui.interaction.error')}</p>}
        </OpenUiSubmissionContext.Provider>
      </Suspense>
    </OpenUiBoundary>
  );
}
