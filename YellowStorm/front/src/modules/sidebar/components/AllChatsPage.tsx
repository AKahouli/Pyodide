import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import {
  useConversationStore,
  useConversationsHasMore,
  useConversationsLoading,
  useHistoryConversations,
} from '@/modules/conversation/store';
import { useConversationV2PointersStore } from '@/modules/conversation-v2/store';
import { RecentChats } from './RecentChats';
import { buildHistoryRows } from './chatGroups';

const ALL_CHATS_LIMIT = 100;

/** Full chat history with client-side search, linked from the sidebar's "All chats". */
export function AllChatsPage() {
  const { t } = useModuleTranslation('sidebar');
  const [search, setSearch] = useState('');
  const conversations = useHistoryConversations();
  const loading = useConversationsLoading();
  const hasMore = useConversationsHasMore();
  const fetchConversations = useConversationStore((s) => s.fetchConversations);
  const v2Pointers = useConversationV2PointersStore((s) => s.items);
  const fetchV2Pointers = useConversationV2PointersStore((s) => s.fetch);

  useEffect(() => {
    fetchConversations({ reset: true, limit: ALL_CHATS_LIMIT });
    fetchV2Pointers({ reset: true });
  }, [fetchConversations, fetchV2Pointers]);

  const loadMore = useCallback(
    () => fetchConversations({ limit: ALL_CHATS_LIMIT }),
    [fetchConversations],
  );

  const rows = useMemo(
    () => buildHistoryRows(conversations, v2Pointers, t('recentChats.untitled')),
    [conversations, v2Pointers, t],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => row.title.toLowerCase().includes(needle));
  }, [rows, search]);

  return (
    <div className='mx-auto flex h-full w-full max-w-3xl flex-col p-6'>
      <div className='mb-6 flex items-center gap-3'>
        <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10'>
          <MessageSquare className='h-5 w-5 text-primary' />
        </div>
        <h1 className='text-xl font-semibold'>{t('allChats.title')}</h1>
      </div>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('allChats.searchPlaceholder')}
        className='mb-4 h-9 max-w-sm'
      />
      <div className='min-h-0 flex-1 overflow-y-auto pr-1'>
        {!loading && filtered.length === 0 ? (
          <p className='py-8 text-sm text-muted-foreground'>{t('allChats.empty')}</p>
        ) : (
          <>
            <RecentChats rows={filtered} loading={loading} />
            {hasMore && !search.trim() && (
              <Button variant='ghost' className='w-full text-xs text-muted-foreground' onClick={loadMore}>
                {t('allChats.loadMore')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
