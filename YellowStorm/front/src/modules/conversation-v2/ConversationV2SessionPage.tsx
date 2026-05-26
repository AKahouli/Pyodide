import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { conversationV2Api } from './api';
import { useConversationV2Store } from './store';
import { useConversationV2Stream } from './useStream';
import { MessageList } from './components/MessageList';
import { Composer } from './components/Composer';
import { PlanPanel } from './components/PlanPanel';
import { RightPanel } from './components/RightPanel/RightPanel';
import { useConversationV2Translation } from './translation';
import type { AgentEvent } from './types';

interface LocationState {
  initialMessage?: string;
}

export default function ConversationV2SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const initialMessage = (location.state as LocationState | null)?.initialMessage;

  const { setSessionId, replayEvents, reset, streamError, events } = useConversationV2Store(
    useShallow((s) => ({
      setSessionId: s.setSessionId,
      replayEvents: s.replayEvents,
      reset: s.reset,
      streamError: s.streamError,
      events: s.events,
    })),
  );
  const { send } = useConversationV2Stream();
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
    setSessionId(sessionId);
    setLoading(true);
    setNotFound(false);
    conversationV2Api
      .getSession(sessionId)
      .then((session) => {
        if (cancelled) return;
        replayEvents(session.events);
      })
      .catch(() => {
        if (cancelled) return;
        setNotFound(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, setSessionId, replayEvents, reset]);

  // Fire off the initial message handed in from the landing page once the
  // session is loaded. Guarded by sentInitialForSession so we don't re-send
  // when the user navigates back to a session that was created with a state.
  useEffect(() => {
    if (loading || notFound) return;
    if (!sessionId || !initialMessage) return;
    if (sentInitialForSession.current === sessionId) return;
    sentInitialForSession.current = sessionId;
    send(initialMessage);
    // Wipe the location state so a refresh doesn't replay the same prompt.
    if (window.history.replaceState) {
      window.history.replaceState({}, '');
    }
  }, [loading, notFound, sessionId, initialMessage, send]);

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
    </div>
  );
}
