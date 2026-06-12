import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { conversationV2Api } from './api';
import { useConversationV2Store } from './store';
import { useConversationV2Stream } from './useStream';
import { MessageList } from './components/MessageList';
import { Composer } from './components/Composer';
import { ConversationV2Header } from './components/ConversationV2Header';
import { FilesSheet } from './components/FilesSheet';
import { PlanPanel } from './components/PlanPanel';
import { RightPanel } from './components/RightPanel/RightPanel';
import { useConversationV2Translation } from './translation';
import { FileViewerSidebar, useFileViewerStore } from '@/modules/file-viewer';
import { useModelsStore } from '@/modules/models';
import type { AgentEvent } from './types';

interface LocationState {
  initialMessage?: string;
  /**
   * LiteLLM model identifier (e.g. "azure/gpt-4.1") resolved on the
   * new-conversation page. Avoids waiting for the models cache to load before
   * we can fire off the first message.
   */
  model?: string;
}

export default function ConversationV2SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const initialMessage = (location.state as LocationState | null)?.initialMessage;
  const initialModel = (location.state as LocationState | null)?.model;

  const {
    setSessionId,
    setSystemWorkspaceId,
    setWorkspaceIds,
    replayEvents,
    reset,
    streamError,
    events,
    hydrateSelectedModelForSession,
  } = useConversationV2Store(
    useShallow((s) => ({
      setSessionId: s.setSessionId,
      setSystemWorkspaceId: s.setSystemWorkspaceId,
      setWorkspaceIds: s.setWorkspaceIds,
      replayEvents: s.replayEvents,
      reset: s.reset,
      streamError: s.streamError,
      events: s.events,
      hydrateSelectedModelForSession: s.hydrateSelectedModelForSession,
    })),
  );
  const { send, openLive } = useConversationV2Stream();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const sentInitialForSession = useRef<string | null>(null);
  const { t } = useConversationV2Translation();

  const latestPlan = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev: AgentEvent = events[i];
      if (ev.type === 'plan') return ev;
    }
    return null;
  }, [events]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    reset();
    // Close the file viewer too — it's a global Zustand store, so a tab opened
    // in conversation A would otherwise stay open when navigating to B.
    useFileViewerStore.getState().closeViewer();
    setSessionId(sessionId);
    // After setSessionId so that setSelectedModelId's persistence path knows
    // which session to write under. If there's no localStorage entry, this
    // leaves selectedModelId: null — the Composer falls through to the admin
    // default, which is exactly what we want for fresh conversations.
    hydrateSelectedModelForSession(sessionId);
    // Idempotent: a no-op if models are already cached (≤ 5 min old).
    void useModelsStore.getState().fetchModels().catch(() => undefined);
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const pointer = await conversationV2Api.getSession(sessionId);
        if (cancelled) return;

        setSystemWorkspaceId(pointer.systemWorkspaceId);
        setWorkspaceIds(pointer.workspaceIds ?? []);

        const collected: AgentEvent[] = [];
        let since = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { items, nextSince } = await conversationV2Api.listEvents(sessionId, since, 200);
          if (cancelled) return;
          collected.push(...items);
          if (items.length === 0) break;
          since = nextSince;
        }
        replayEvents(collected);

        const nonTerminal = pointer.status === 'active' || pointer.status === 'waiting';
        if (nonTerminal) openLive();
      } catch {
        if (cancelled) return;
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, setSessionId, setSystemWorkspaceId, setWorkspaceIds, replayEvents, reset, hydrateSelectedModelForSession, openLive]);

  // Fire off the initial message handed in from the landing page once the
  // session is loaded. Guarded by sentInitialForSession so we don't re-send
  // when the user navigates back to a session that was created with a state.
  useEffect(() => {
    if (loading || notFound) return;
    if (!sessionId || !initialMessage) return;
    if (sentInitialForSession.current === sessionId) return;
    sentInitialForSession.current = sessionId;
    send(initialMessage, initialModel);
    // Wipe the location state so a refresh doesn't replay the same prompt.
    if (window.history.replaceState) {
      window.history.replaceState({}, '');
    }
  }, [loading, notFound, sessionId, initialMessage, initialModel, send]);

  if (loading) {
    return (
      <div className='flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground'>
        {t('session.loading')}
      </div>
    );
  }
  if (notFound) {
    return (
      <div className='flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground'>
        {t('session.notFound')}
      </div>
    );
  }

  return (
    <div className='relative flex w-full min-h-0 flex-1'>
      <div key={sessionId} className='flex min-w-0 flex-1 flex-col'>
        <ConversationV2Header />
        {streamError && (
          <div className='bg-destructive p-2 text-sm text-destructive-foreground'>
            {t('session.errorTitle')}: {streamError}
          </div>
        )}
        <MessageList />
        {latestPlan && (
          <div className='shrink-0 pb-2'>
            <PlanPanel steps={latestPlan.steps} />
          </div>
        )}
        <Composer onSend={send} />
      </div>
      <RightPanel />
      <FileViewerSidebar />
      <FilesSheet />
    </div>
  );
}
