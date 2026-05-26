import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MessageList } from './components/MessageList';
import { conversationV2Api, type SessionPointer } from './api';
import { useConversationV2Store } from './store';
import type { AgentEvent } from './types';

export default function SharedConversationV2Page() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<SessionPointer | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    conversationV2Api
      .getShared(token)
      .then(({ session: s, events: evs }) => {
        setSession(s);
        setEvents(evs);
        useConversationV2Store.getState().setSystemWorkspaceId(s.systemWorkspaceId);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  if (error) return <div className='p-6 text-sm text-destructive'>{error}</div>;
  if (!session) return <div className='p-6 text-sm text-muted-foreground'>Loading…</div>;

  return (
    <div className='mx-auto max-w-3xl p-6'>
      <h1 className='mb-4 text-lg font-semibold'>{session.title || 'Shared session'}</h1>
      <MessageList events={events} readOnly />
    </div>
  );
}
