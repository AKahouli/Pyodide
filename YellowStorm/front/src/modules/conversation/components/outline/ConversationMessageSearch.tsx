import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/modules/auth';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchConversationMessages } from '../../api';
import { useConversationStore } from '../../store';
import { useConversationUiStore } from '../../uiStore';
import type { ConversationMessageSearch } from '../../types';

/** Server search is separate from the loaded-heading filter. */
export function ConversationMessageSearch({ onSelect }: { onSelect?: () => void }) {
  const { t } = useModuleTranslation('conversation');
  const { user } = useAuth();
  const conversationId = useConversationStore(state => state.currentConversationId);
  const location = useLocation(), navigate = useNavigate();
  const [query, setQuery] = useState(''), [response, setResponse] = useState<{ scope: string; data: ConversationMessageSearch }>();
  const [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const request = useRef<AbortController>();
  const scope = `${user?.id ?? ''}:${conversationId ?? ''}`;
  const result = response?.scope === scope ? response.data : undefined;
  const setResult = (data: ConversationMessageSearch | undefined) => setResponse(data ? { scope, data } : undefined);
  const current = useRef(scope); current.current = scope;
  useEffect(() => { request.current?.abort(); setQuery(''); setResult(undefined); setError(false); setLoading(false); return () => request.current?.abort(); }, [scope]);
  async function search() {
    if (!conversationId || !user?.id || !query.trim()) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const owner = scope; setLoading(true); setError(false); setResult(undefined);
    try {
      const found = await searchConversationMessages(conversationId, query.trim(), controller.signal);
      if (!controller.signal.aborted && current.current === owner) setResult(found);
    } catch { if (!controller.signal.aborted && current.current === owner) setError(true); }
    finally { if (!controller.signal.aborted && current.current === owner) setLoading(false); }
  }
  return <section className='space-y-2 border-b px-3 py-2' aria-label={t('outline.conversationSearch')}>
    <form className='flex gap-1' onSubmit={event => { event.preventDefault(); void search(); }}>
      <Input className='h-8 min-w-0 text-xs' maxLength={200} value={query} onChange={event => setQuery(event.target.value)} aria-label={t('outline.conversationSearch')} placeholder={t('outline.conversationSearch')} />
      <Button type='submit' variant='outline' size='sm' disabled={loading || !query.trim()}>{t('outline.searchConversation')}</Button>
    </form>
    {loading && <p role='status' className='text-xs'>{t('outline.searching')}</p>}
    {error && <p role='alert' className='text-xs'>{t('outline.searchError')}</p>}
    {result && <ul className='max-h-64 space-y-1 overflow-y-auto'>{result.matches.map(match => <li key={match.messageId}><button className='w-full rounded px-2 py-1 text-left text-xs hover:bg-muted' type='button' onClick={() => {
      const params = new URLSearchParams(location.search); params.set('message', match.messageId);
      navigate({ pathname: location.pathname, search: params.toString() }); onSelect?.();
    }}>{match.snippet}</button></li>)}</ul>}
    {result && !result.matches.length && <p role='status' className='text-xs'>{t('outline.searchNoResults')}</p>}
    {result?.hasMore && <p className='text-xs text-muted-foreground'>{t('outline.searchMore')}</p>}
  </section>;
}

/** Restores a stable route target before the scroller consumes its DOM anchor. */
export function MessageRouteAnchorLoader() {
  const { t } = useModuleTranslation('conversation');
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const conversationId = useConversationStore(state => state.currentConversationId);
  const loadingMessages = useConversationStore(state => state.messagesLoading);
  const loadAround = useConversationStore(state => state.loadMessageAround);
  const [error, setError] = useState(false), [loading, setLoading] = useState(false);
  const target = new URLSearchParams(location.search).get('message');
  useEffect(() => {
    setError(false); setLoading(false);
    if (!target || !user?.id || !conversationId || id !== conversationId || loadingMessages) return;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(target)) { setError(true); return; }
    const controller = new AbortController(); setLoading(true);
    void loadAround(target, controller.signal).then(() => {
      if (!controller.signal.aborted) useConversationUiStore.getState().requestOutlineScroll(`message-${target}`);
    }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [target, location.key, user?.id, conversationId, id, loadingMessages, loadAround]);
  return error ? <p role='alert' className='p-2 text-xs text-destructive'>{t('outline.jumpError')}</p> : loading ? <p role='status' className='p-2 text-xs'>{t('outline.loadingTarget')}</p> : null;
}
