/**
 * Pure helpers shared by the sidebar "Recent chats" rail, the All chats page
 * and the global search palette.
 */

export type DayBucket = 'today' | 'yesterday' | 'last7' | 'older';

export const DAY_BUCKETS: readonly DayBucket[] = ['today', 'yesterday', 'last7', 'older'] as const;

/** Maximum rows rendered in the sidebar rail before the "All chats" link. */
export const RECENT_CHATS_CAP = 25;

const DAY_MS = 86_400_000;

interface RowTime {
  id: string;
  title: string;
  sortTime: number;
}

export interface HistoryRow extends RowTime {
  kind: 'v1' | 'v2';
  /** Route target for the row. */
  to: string;
  /** Original v1 conversation (typed loosely to avoid store imports here). */
  conv?: { id: string; title: string; projectId?: string | null; isGroup?: boolean; isShared?: boolean; unseenMentionCount?: number };
  /** Original v2 pointer. */
  ptr?: { sessionId: string; title?: string | null };
}

export function dayBucket(sortTime: number, now = Date.now()): DayBucket {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const start = startOfToday.getTime();
  if (sortTime >= start) return 'today';
  if (sortTime >= start - DAY_MS) return 'yesterday';
  if (sortTime >= start - 7 * DAY_MS) return 'last7';
  return 'older';
}

/** Rows must be sorted newest-first; groups come back in that order, empty groups omitted. */
export function groupByDay<T extends RowTime>(rows: T[], now = Date.now()): Array<{ bucket: DayBucket; rows: T[] }> {
  const groups = new Map<DayBucket, T[]>();
  for (const row of rows) {
    const bucket = dayBucket(row.sortTime, now);
    const list = groups.get(bucket);
    if (list) list.push(row);
    else groups.set(bucket, [row]);
  }
  return [...groups.entries()].map(([bucket, list]) => ({ bucket, rows: list }));
}

/** When several visible chats share a title, suffix a short timestamp so rows stay distinguishable. */
export function disambiguateTitles<T extends RowTime>(rows: T[], now = Date.now()): Array<T & { displayTitle: string }> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.title, (counts.get(row.title) ?? 0) + 1);
  return rows.map((row) => ({
    ...row,
    displayTitle: (counts.get(row.title) ?? 1) > 1 ? `${row.title} · ${formatShort(row.sortTime, now)}` : row.title,
  }));
}

function formatShort(time: number, now: number): string {
  const sameDay = dayBucket(time, now) === 'today';
  return sameDay
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(time)
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(time);
}

interface V1ConversationLike {
  id: string;
  title: string;
  updatedAt?: string | null;
  lastMessageAt?: string | null;
  createdAt?: string | null;
  projectId?: string | null;
  isGroup?: boolean;
  isShared?: boolean;
  unseenMentionCount?: number;
}

interface V2PointerLike {
  sessionId: string;
  title?: string | null;
  lastEventAt: string;
}

/** Merge v1 conversations and v2 sessions into one newest-first list. */
export function buildHistoryRows(conversations: V1ConversationLike[], pointers: V2PointerLike[], untitled: string): HistoryRow[] {
  const v1: HistoryRow[] = conversations.map((conv) => ({
    kind: 'v1',
    id: conv.id,
    title: conv.title,
    to: `/conversation/${conv.id}`,
    sortTime: new Date(conv.updatedAt ?? conv.lastMessageAt ?? conv.createdAt ?? 0).getTime(),
    conv,
  }));
  const v2: HistoryRow[] = pointers.map((ptr) => ({
    kind: 'v2',
    id: ptr.sessionId,
    title: ptr.title || untitled,
    to: `/conversation-v2/${ptr.sessionId}`,
    sortTime: new Date(ptr.lastEventAt).getTime(),
    ptr,
  }));
  return [...v1, ...v2].sort((a, b) => b.sortTime - a.sortTime);
}
