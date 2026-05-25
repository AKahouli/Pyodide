import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MessageList } from './components/MessageList';
import { conversationV2Api } from './api';
import type { SessionPayload } from './types';

export default function SharedConversationV2Page() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    conversationV2Api
      .getShared(token)
      .then((data) => setSession(data))
      .catch((e: Error) => setError(e.message));
  }, [token]);

  if (error) return <div className='p-6 text-sm text-destructive'>{error}</div>;
  if (!session) return <div className='p-6 text-sm text-muted-foreground'>Loading…</div>;

  return (
    <div className='mx-auto max-w-3xl p-6'>
      <h1 className='mb-4 text-lg font-semibold'>{session.title || 'Shared session'}</h1>
      <MessageList events={session.events} readOnly />
    </div>
  );
}
