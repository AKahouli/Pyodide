import { useEffect, useMemo, useCallback } from 'react';
import {
  useConversationStore,
  useConversations,
  useConversationsLoading,
  useConversationsHasMore,
  DEFAULT_CONVERSATIONS_LIMIT,
} from '@/modules/conversation/store';
import { useConversationV2PointersStore, DEFAULT_V2_LIMIT } from './store';
import type { ConversationV2PointerSummary } from './types';

export interface MergedConversationItem {
  id: string;
  title: string;
  lastEventAt: string;
  kind: 'v1' | 'v2';
  isShared?: boolean;
}

interface V1ShapeLike {
  id: string;
  title: string;
  lastMessageAt: string;
}

export function mergeConversations(
  v1: V1ShapeLike[],
  v2: ConversationV2PointerSummary[],
): MergedConversationItem[] {
  const items: MergedConversationItem[] = [
    ...v1.map((c) => ({
      id: c.id,
      title: c.title,
      lastEventAt: c.lastMessageAt,
      kind: 'v1' as const,
    })),
    ...v2.map((p) => ({
      id: p.sessionId,
      title: p.title || 'Untitled',
      lastEventAt: p.lastEventAt,
      kind: 'v2' as const,
      isShared: p.isShared,
    })),
  ];
  items.sort((a, b) => (a.lastEventAt < b.lastEventAt ? 1 : a.lastEventAt > b.lastEventAt ? -1 : 0));
  return items;
}

export function useMergedConversations() {
  const v1Items = useConversations();
  const v1Loading = useConversationsLoading();
  const v1HasMore = useConversationsHasMore();
  const fetchV1 = useConversationStore((s) => s.fetchConversations);

  const v2Items = useConversationV2PointersStore((s) => s.items);
  const v2Loading = useConversationV2PointersStore((s) => s.loading);
  const v2HasMore = useConversationV2PointersStore((s) => s.nextCursor != null);
  const fetchV2 = useConversationV2PointersStore((s) => s.fetch);

  useEffect(() => {
    fetchV2({ reset: true, limit: DEFAULT_V2_LIMIT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const merged = useMemo(() => mergeConversations(v1Items as any, v2Items), [v1Items, v2Items]);

  const loadMore = useCallback(() => {
    const v1Tail = v1Items.at(-1)?.lastMessageAt ?? null;
    const v2Tail = v2Items.at(-1)?.lastEventAt ?? null;
    // If only one store has more pages, advance it unconditionally.
    if (v1HasMore && !v2HasMore) {
      fetchV1({ limit: DEFAULT_CONVERSATIONS_LIMIT });
      return;
    }
    if (v2HasMore && !v1HasMore) {
      fetchV2({ limit: DEFAULT_V2_LIMIT });
      return;
    }
    // Both have more — advance whichever store has the older tail (or both if tails are within
    // one page of each other).
    if (v1HasMore && v2HasMore) {
      const noTails = !v1Tail || !v2Tail;
      if (noTails || (v1Tail && v2Tail && v1Tail >= v2Tail)) {
        fetchV1({ limit: DEFAULT_CONVERSATIONS_LIMIT });
      }
      if (noTails || (v1Tail && v2Tail && v2Tail >= v1Tail)) {
        fetchV2({ limit: DEFAULT_V2_LIMIT });
      }
    }
  }, [v1Items, v2Items, v1HasMore, v2HasMore, fetchV1, fetchV2]);

  return {
    items: merged,
    loading: v1Loading || v2Loading,
    hasMore: v1HasMore || v2HasMore,
    loadMore,
  };
}
