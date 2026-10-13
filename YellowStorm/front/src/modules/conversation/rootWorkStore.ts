import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { stopRootWork } from './api';
import type { RootWorkSnapshot } from './types';
import type { RootWorkReplay } from './components/root-work-replay';

export const initialRootWorkState = { userId: null as string | null, snapshots: {} as Record<string, RootWorkSnapshot>,
  activity: {} as Record<string, RootWorkReplay>, knownPublicationIds: {} as Record<string, string[]>, unreadPublicationIds: {} as Record<string, string[]>, revision: 0, readPublicationIds: {} as Record<string, string[]>, pendingStops: {} as Record<string, Parameters<typeof stopRootWork>[1] | undefined> };
interface RootWorkState {
  userId: string | null;
  snapshots: Record<string, RootWorkSnapshot>;
  activity: Record<string, RootWorkReplay>;
  unreadPublicationIds: Record<string, string[]>;
  knownPublicationIds: Record<string, string[]>;
  registerPublication: (conversationId: string, messageId: string) => void;
  revision: number;
  readPublicationIds: Record<string, string[]>;
  pendingStops: Record<string, Parameters<typeof stopRootWork>[1] | undefined>;
  setPendingStop: (conversationId: string, request: Parameters<typeof stopRootWork>[1] | undefined) => void;
  bindUser: (userId: string | null) => void;
  update: (conversationId: string, snapshot: RootWorkSnapshot, activity?: RootWorkReplay) => void;
  markResultRead: (conversationId: string, messageId: string) => void;

  refresh: () => void;
  clearConversation: (conversationId: string) => void;
}
function readIds(userId: string, conversationId: string, kind = 'read'): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`conversation-work-${kind}:${userId}:${conversationId}`) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(-1000) : [];
  } catch { return []; }
}
export const useRootWorkStore = create<RootWorkState>()(devtools((set, get) => ({
  ...initialRootWorkState,
  bindUser: (userId) => { if (get().userId !== userId) set({ ...initialRootWorkState, userId }); },
  update: (conversationId, snapshot, activity) => {
    const state = get();
    if (!state.userId || (state.snapshots[conversationId]?.epoch ?? -1) > snapshot.epoch) return;
    const read = new Set([...readIds(state.userId, conversationId), ...(state.readPublicationIds[conversationId] ?? [])]);
    const publications = [...new Set([...readIds(state.userId, conversationId, 'known'), ...(state.knownPublicationIds[conversationId] ?? []),
      ...snapshot.jobs.flatMap((job) => job.publicationMessageId ? [job.publicationMessageId] : [])])].slice(-1000);
    try { localStorage.setItem(`conversation-work-known:${state.userId}:${conversationId}`, JSON.stringify(publications)); }
    catch { /* The bounded in-memory registry still survives epoch changes. */ }
    set({ knownPublicationIds: { ...state.knownPublicationIds, [conversationId]: publications }, snapshots: { ...state.snapshots, [conversationId]: snapshot },
      ...(activity ? { activity: { ...state.activity, [conversationId]: activity } } : {}),
      unreadPublicationIds: { ...state.unreadPublicationIds, [conversationId]: publications.filter((id) => !read.has(id)) } });
  },
  registerPublication: (conversationId, messageId) => {
    const state = get();
    if (!state.userId || state.knownPublicationIds[conversationId]?.includes(messageId)) return;
    const known = [...new Set([...readIds(state.userId, conversationId, 'known'), ...(state.knownPublicationIds[conversationId] ?? []), messageId])].slice(-1000);
    const read = new Set([...readIds(state.userId, conversationId), ...(state.readPublicationIds[conversationId] ?? [])]);
    try { localStorage.setItem(`conversation-work-known:${state.userId}:${conversationId}`, JSON.stringify(known)); }
    catch { /* Keep the registry in memory when storage is unavailable. */ }
    set({ knownPublicationIds: { ...state.knownPublicationIds, [conversationId]: known },
      unreadPublicationIds: { ...state.unreadPublicationIds, [conversationId]: known.filter((id) => !read.has(id)) } });
  },
  markResultRead: (conversationId, messageId) => {
    const state = get();
    if (!state.userId) return;
    const read = [...new Set([...readIds(state.userId, conversationId), ...(state.readPublicationIds[conversationId] ?? []), messageId])].slice(-1000);
    try { localStorage.setItem(`conversation-work-read:${state.userId}:${conversationId}`, JSON.stringify(read)); }
    catch { /* Storage may be unavailable; reading still updates this session. */ }
    set({ readPublicationIds: { ...state.readPublicationIds, [conversationId]: read }, unreadPublicationIds: { ...state.unreadPublicationIds,
      [conversationId]: (state.unreadPublicationIds[conversationId] ?? []).filter((id) => id !== messageId) } });
  },
  setPendingStop: (conversationId, request) => set({ pendingStops: { ...get().pendingStops, [conversationId]: request } }),
  refresh: () => set({ revision: get().revision + 1 }),
  clearConversation: (conversationId) => {
    const { snapshots, activity, unreadPublicationIds } = get();
    const nextSnapshots = { ...snapshots }; delete nextSnapshots[conversationId];
    const nextActivity = { ...activity }; delete nextActivity[conversationId];
    const nextUnread = { ...unreadPublicationIds }; delete nextUnread[conversationId];
    set({ snapshots: nextSnapshots, activity: nextActivity, unreadPublicationIds: nextUnread });
  },
}), { name: 'conversation-root-work-store' }));
