import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionEvent } from '@openuidev/react-lang';
import { AIMessageContent, type CitationData } from '@/components/ai-elements/ai-message-content';
import { useConversationStore } from '../../store';
import { MiniAppAutosaveContext, OpenUiSubmissionContext, submissionKey, submissionSignature, toFollowUpMessage } from './actions';
import { AuthContext } from '@/modules/auth/AuthContext';
import { useMiniAppState } from './use-mini-app-state';
import { MiniAppTaskContext } from './mini-app-task-context';
import { Button } from '@/components/ui/button';
import { OpenUiBoundary } from './OpenUiBoundary';
import { loadOpenUiRenderer } from './preload';
import { downloadArtifactFile, getArtifactDownloadUrl, stopStream as stopTaskStream } from '../../api';
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
  const actorId = useContext(AuthContext)?.user?.id ?? '';
  const sourceKey = !props.isStreaming && /\bMiniApp\s*\(/.test(props.content) ? props.content : '';
  return <ScopedOpenUiAnswer key={`${actorId}:${props.conversationId}:${props.messageId}:${props.partId ?? ''}:${sourceKey}`} {...props} actorId={actorId} />;
}
function ScopedOpenUiAnswer({ content, isStreaming, conversationId, messageId, citations, artifacts, partId, actorId }: Readonly<OpenUiAnswerProps & { actorId: string }>) {
  const { t } = useModuleTranslation('conversation');
  const messages = useConversationStore(state => state.messages);
  const [localStatus, setLocalStatus] = useState<Record<string, 'submitting' | 'submitted' | 'error'>>({});
  const [runningTask, setRunningTask] = useState<{ formName: string; answerId?: string }>();
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const retries = useRef(new Map<string, string>());
  const accepted = useRef(new Map<string, string>());
  const saved = useMemo(() => messages.filter(message => message.conversationType === 'user' && message.interaction?.type === 'openui'
    && message.interaction.sourceMessageId === messageId && message.interaction.componentId === partId
    && message.conversationId === conversationId && !message.id.startsWith('temp-'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(message => message.interaction as OpenUiSubmission), [messages, messageId, partId, conversationId]);
  const savedStateSignature = submissionSignature(Object.assign({}, ...saved.map(submission => submission.formState)));
  const initialState = useMemo(() => JSON.parse(savedStateSignature) as Record<string, unknown>, [savedStateSignature]);
  const miniApp = !isStreaming && Boolean(partId && actorId) && /\bMiniApp\s*\(/.test(content);
  const [digest, setDigest] = useState<{ content: string; hash?: string; failed?: boolean }>();
  const [hashAttempt, setHashAttempt] = useState(0);
  useEffect(() => {
    if (!miniApp) return;
    let active = true;
    setDigest(undefined);
    void Promise.resolve().then(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))).then(bytes => {
      if (active) setDigest({ content, hash: Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('') });
    }).catch(() => { if (active) setDigest({ content, failed: true }); });
    return () => { active = false; };
  }, [content, miniApp, hashAttempt]);
  const digestReady = digest?.content === content && Boolean(digest.hash);
  const draft = useMiniAppState({ identity: { userId: actorId, conversationId, messageId, componentId: partId ?? '', programDigest: digest?.hash ?? '' },
    enabled: miniApp && digestReady, fallbackState: initialState });
  const draftStatus = digest?.failed ? 'error' : !digestReady ? 'loading' : draft.status;
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
      let openUiSubmission: OpenUiSubmission = { type: 'openui', schemaVersion: 1, sourceMessageId: messageId, componentId: partId,
        actionType: 'continue_conversation', ...followUp.submission };
      if (event.type === 'AskAgent' && miniApp) {
        busy.current = true;
        const key = submissionKey(openUiSubmission);
        setLocalStatus(previous => ({ ...previous, [key]: 'submitting' }));
        void (async () => {
          const snapshot = await draft.flush();
          if (!active.current) return;
          const current = useConversationStore.getState();
          if (current.isStreaming || (current.currentConversationId && current.currentConversationId !== conversationId)) throw new Error('Task scope changed');
          openUiSubmission = { ...openUiSubmission, appTask: { schemaVersion: 1, ...snapshot, documentIds: followUp.documentIds ?? [] } };
          const signature = submissionSignature(openUiSubmission);
          const requestId = retries.current.get(signature) ?? crypto.randomUUID();
          retries.current.set(signature, requestId);
          setRunningTask({ formName: key });
          await state.sendMessage(conversationId, { content: followUp.content, openUiSubmission, requestId, parentMessageId: messageId },
            answerId => { if (active.current) setRunningTask({ formName: key, answerId }); });
          if (!active.current) return;
          retries.current.delete(signature);
          setLocalStatus(previous => ({ ...previous, [key]: 'submitted' }));
        })().catch(() => { if (active.current) { setRunningTask(undefined); setLocalStatus(previous => ({ ...previous, [key]: 'error' })); } })
          .finally(() => { busy.current = false; });
        return;
      }
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
  }, [conversationId, messageId, partId, artifacts, isStreaming, saved, t, miniApp, draft.flush]);

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
        {miniApp && <div className='mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
          <p role={['error', 'conflict'].includes(draftStatus) ? 'alert' : 'status'}>{t(`openui.draft.${draftStatus}`)}</p>
          {draftStatus === 'error' && <Button size='sm' variant='outline' onClick={() => digest?.failed ? setHashAttempt(value => value + 1) : draft.retry()}>{t('openui.draft.retry')}</Button>}
          {draftStatus === 'conflict' && <>
            <Button size='sm' variant='outline' onClick={draft.reload}>{t('openui.draft.reload')}</Button>
            <Button size='sm' variant='outline' onClick={draft.reapply}>{t('openui.draft.reapply')}</Button>
          </>}
        </div>}
        <OpenUiSubmissionContext.Provider value={statuses}>
          <MiniAppAutosaveContext.Provider value={miniApp}>
            <MiniAppTaskContext.Provider value={miniApp ? { conversationId, actorId, messageId, componentId: partId ?? '', programDigest: digest?.hash ?? '', running: runningTask,
              stateRevision: draft.stateRevision, dirty: draft.status !== 'saved' && draft.status !== 'readonly',
              cancel: answerId => stopTaskStream(conversationId, answerId) } : null}>
            <fieldset disabled={Object.values(localStatus).includes('submitting') || (miniApp && draft.status === 'readonly')} className='m-0 min-w-0 border-0 p-0'>
              {miniApp && (!digestReady || !draft.ready) ? null : <OpenUiRenderer key={miniApp ? draft.mountRevision : 'legacy'} content={content} isStreaming={isStreaming} onAction={handleAction} citations={citations} citationScope={citationScope} fallback={renderMarkdown} partId={partId} initialState={miniApp ? draft.initialState : initialState} onStateUpdate={miniApp ? draft.handleStateUpdate : undefined} />}
            </fieldset>
            </MiniAppTaskContext.Provider>
          </MiniAppAutosaveContext.Provider>
          {Object.values(localStatus).includes('error') && <p role='alert' className='mt-2 text-sm text-destructive'>{t('openui.interaction.error')}</p>}
        </OpenUiSubmissionContext.Provider>
      </Suspense>
    </OpenUiBoundary>
  );
}
