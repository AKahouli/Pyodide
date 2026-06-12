import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { conversationV2Api } from './api';
import { useConversationV2Store } from './store';
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
  /** Skill selection carried from the new-conversation page for the initial send. */
  skillIds?: string[];
  /** Connector selection carried from the new-conversation page for the initial send. */
  connectorIds?: string[];
}

export default function ConversationV2SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const initialMessage = (location.state as LocationState | null)?.initialMessage;
  const initialModel = (location.state as LocationState | null)?.model;
  const initialSkillIds = (location.state as LocationState | null)?.skillIds;
  const initialConnectorIds = (location.state as LocationState | null)?.connectorIds;

  const {
    switchToSession,
    setSystemWorkspaceId,
    setWorkspaceIds,
    setSelectedSkillIds,
    setSelectedConnectorIds,
    replayEvents,
    setStreaming,
    streamError,
    events,
    hydrateSelectedModelForSession,
    sendMessage,
  } = useConversationV2Store(
    useShallow((s) => ({
      switchToSession: s.switchToSession,
      setSystemWorkspaceId: s.setSystemWorkspaceId,
      setWorkspaceIds: s.setWorkspaceIds,
      setSelectedSkillIds: s.setSelectedSkillIds,
      setSelectedConnectorIds: s.setSelectedConnectorIds,
      replayEvents: s.replayEvents,
      setStreaming: s.setStreaming,
      streamError: s.streamError,
      events: s.events,
      hydrateSelectedModelForSession: s.hydrateSelectedModelForSession,
      sendMessage: s.sendMessage,
    })),
  );
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
    // Close the file viewer too — it's a global Zustand store, so a tab opened
    // in conversation A would otherwise stay open when navigating to B.
    useFileViewerStore.getState().closeViewer();
    // Switch the on-screen conversation. If this session is streaming in the
    // background (its live state is cached), we hydrate instantly and skip the
    // server reload + spinner — that's what makes switching between concurrent
    // conversations feel instant. Otherwise we fall through to a fresh load.
    const hydratedFromCache = switchToSession(sessionId);
    // After switchToSession so the model-persistence path knows which session
    // to write under. New conversations leave selectedModelId null → the
    // Composer falls back to the admin default.
    hydrateSelectedModelForSession(sessionId);
    // Idempotent: a no-op if models are already cached (≤ 5 min old).
    void useModelsStore.getState().fetchModels().catch(() => undefined);
    setNotFound(false);

    if (hydratedFromCache) {
      // Live state already in memory; just refresh pointer metadata.
      setLoading(false);
      (async () => {
        try {
          const pointer = await conversationV2Api.getSession(sessionId);
          if (cancelled) return;
          setSystemWorkspaceId(pointer.systemWorkspaceId);
          setWorkspaceIds(pointer.workspaceIds ?? []);
          setSelectedSkillIds(pointer.selectedSkillIds ?? []);
          // Connector selection isn't persisted on the pointer; clear it so a
          // selection from another session doesn't leak in (re-applied below for
          // a fresh agent conversation from its nav state).
          setSelectedConnectorIds([]);
        } catch {
          /* keep the cached view */
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    (async () => {
      try {
        const pointer = await conversationV2Api.getSession(sessionId);
        if (cancelled) return;

        setSystemWorkspaceId(pointer.systemWorkspaceId);
        setWorkspaceIds(pointer.workspaceIds ?? []);
        setSelectedSkillIds(pointer.selectedSkillIds ?? []);
        setSelectedConnectorIds([]);

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

        // If the session is mid-turn server-side, show the thinking state; the
        // per-user pipe delivers the rest (and a done/error to clear it). Guard
        // the fresh-session case (status 'active' but no events yet).
        const nonTerminal = pointer.status === 'active' || pointer.status === 'waiting';
        const last = collected[collected.length - 1];
        const lastIsTerminal = last?.type === 'done' || last?.type === 'error';
        setStreaming(nonTerminal && collected.length > 0 && !lastIsTerminal);
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
  }, [sessionId, switchToSession, setSystemWorkspaceId, setWorkspaceIds, setSelectedSkillIds, replayEvents, setStreaming, hydrateSelectedModelForSession]);

  // Fire off the initial message handed in from the landing page once the
  // session is loaded. Guarded by sentInitialForSession so we don't re-send
  // when the user navigates back to a session that was created with a state.
  useEffect(() => {
    if (loading || notFound) return;
    if (!sessionId || !initialMessage) return;
    if (sentInitialForSession.current === sessionId) return;
    sentInitialForSession.current = sessionId;
    // Re-apply the skill selection carried from the landing page. The loader
    // ran first and reset selectedSkillIds from the (empty) new-session pointer;
    // restore it here so sendMessage (which reads it from the store) ships it.
    if (initialSkillIds?.length) setSelectedSkillIds(initialSkillIds);
    if (initialConnectorIds?.length) setSelectedConnectorIds(initialConnectorIds);
    void sendMessage(initialMessage, initialModel);
    // Wipe the location state so a refresh doesn't replay the same prompt.
    if (window.history.replaceState) {
      window.history.replaceState({}, '');
    }
  }, [loading, notFound, sessionId, initialMessage, initialModel, initialSkillIds, setSelectedSkillIds, initialConnectorIds, setSelectedConnectorIds, sendMessage]);

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
        <Composer onSend={sendMessage} />
      </div>
      <RightPanel />
      <FileViewerSidebar />
      <FilesSheet />
    </div>
  );
}
