import type { PlaybookState, PlaybookVM } from '../utils/playbookVM';
import { isLive, neverRun, stateRank, successRate } from '../utils/playbookVM';

/** URL-synced console state (spec §7.1). All of it lives in the query string. */
export type SegmentId = 'all' | 'live' | 'fav' | 'scheduled' | 'never';
export type ConsoleView = 'table' | 'board' | 'cards';
export type SortKey = 'name' | 'state' | 'reliability' | 'steps' | 'lastRun';
export type SortDir = 'asc' | 'desc';

export interface ConsoleState {
  seg: SegmentId;
  q: string;
  states: PlaybookState[];
  view: ConsoleView;
  sort: SortKey;
  dir: SortDir;
  minSteps?: number;
  maxSteps?: number;
  dateField: 'createdAt' | 'updatedAt' | 'lastExecutionAt';
  from?: string;
  to?: string;
  dupOnly: boolean;
}

export const DEFAULT_STATE: ConsoleState = {
  seg: 'all',
  q: '',
  states: [],
  view: 'table',
  sort: 'lastRun',
  dir: 'desc',
  dateField: 'updatedAt',
  dupOnly: false,
};

export const VIEW_STORAGE_KEY = 'ym.playbooks.view';
export const TIDY_STORAGE_KEY = 'ym.playbooks.tidyDismissedUntil';

export function parseConsoleState(params: URLSearchParams, storedView: ConsoleView | null, playbookCount: number): ConsoleState {
  const seg = (['all', 'live', 'fav', 'scheduled', 'never'] as const).includes(params.get('seg') as SegmentId)
    ? (params.get('seg') as SegmentId)
    : 'all';
  const rawStates = (params.get('state') ?? '').split(',').filter(Boolean) as PlaybookState[];
  const view = (['table', 'board', 'cards'] as const).includes(params.get('view') as ConsoleView)
    ? (params.get('view') as ConsoleView)
    : params.has('view')
      ? 'table'
      : storedView ?? (playbookCount > 0 && playbookCount <= 6 ? 'cards' : 'table');
  const sort = (['name', 'state', 'reliability', 'steps', 'lastRun'] as const).includes(params.get('sort') as SortKey)
    ? (params.get('sort') as SortKey)
    : 'lastRun';
  const dir = params.get('dir') === 'asc' ? 'asc' : params.get('dir') === 'desc' ? 'desc' : sort === 'name' ? 'asc' : 'desc';
  const min = parseInt(params.get('minSteps') ?? '', 10);
  const max = parseInt(params.get('maxSteps') ?? '', 10);
  const dateField = (['createdAt', 'updatedAt', 'lastExecutionAt'] as const).includes(params.get('dateField') as ConsoleState['dateField'])
    ? (params.get('dateField') as ConsoleState['dateField'])
    : 'updatedAt';
  return {
    seg,
    q: params.get('q') ?? '',
    states: rawStates,
    view,
    sort,
    dir,
    minSteps: Number.isFinite(min) ? min : undefined,
    maxSteps: Number.isFinite(max) ? max : undefined,
    dateField,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    dupOnly: params.get('dup') === '1',
  };
}

export function serializeConsoleState(state: ConsoleState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.seg !== 'all') params.set('seg', state.seg);
  if (state.q) params.set('q', state.q);
  if (state.states.length) params.set('state', state.states.join(','));
  if (state.view !== 'table') params.set('view', state.view);
  if (state.sort !== 'lastRun') params.set('sort', state.sort);
  if (!(state.sort === 'lastRun' && state.dir === 'desc') && !(state.sort === 'name' && state.dir === 'asc')) {
    params.set('dir', state.dir);
  }
  if (state.minSteps !== undefined) params.set('minSteps', String(state.minSteps));
  if (state.maxSteps !== undefined) params.set('maxSteps', String(state.maxSteps));
  if (state.dateField !== 'updatedAt') params.set('dateField', state.dateField);
  if (state.from) params.set('from', state.from);
  if (state.to) params.set('to', state.to);
  if (state.dupOnly) params.set('dup', '1');
  return params;
}

// ---- segments (spec §7.3) ----

export const SEGMENT_PREDICATES: Record<SegmentId, (p: PlaybookVM) => boolean> = {
  all: () => true,
  live: isLive,
  fav: (p) => p.isFavorite,
  scheduled: (p) => p.trigger.kind !== 'manual',
  never: neverRun,
};

export function segmentCounts(playbooks: PlaybookVM[]): Record<SegmentId, number> {
  const counts = { all: 0, live: 0, fav: 0, scheduled: 0, never: 0 } as Record<SegmentId, number>;
  for (const p of playbooks) {
    counts.all++;
    for (const key of ['live', 'fav', 'scheduled', 'never'] as const) {
      if (SEGMENT_PREDICATES[key](p)) counts[key]++;
    }
  }
  return counts;
}

// ---- filtering (spec §7.4) ----

export function matchesPlaybook(p: PlaybookVM, state: ConsoleState): boolean {
  if (state.q) {
    const q = state.q.toLowerCase();
    const haystack = `${p.name} ${p.purpose} ${p.labels.join(' ')}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (state.states.length && !state.states.includes(p.state)) return false;
  if (state.minSteps !== undefined && (p.stepCount === null || p.stepCount < state.minSteps)) return false;
  if (state.maxSteps !== undefined && (p.stepCount === null || p.stepCount > state.maxSteps)) return false;
  if (state.from || state.to) {
    const reference = state.dateField === 'lastExecutionAt' ? p.lastRun?.startedAt : p[state.dateField];
    if (!reference) return false;
    const time = new Date(reference).getTime();
    if (state.from && time < new Date(`${state.from}T00:00:00`).getTime()) return false;
    if (state.to && time > new Date(`${state.to}T23:59:59.999`).getTime()) return false;
  }
  if (state.dupOnly && !p.duplicateOfId) return false;
  return true;
}

// ---- sorting (spec §7.5) ----

export function comparePlaybooks(a: PlaybookVM, b: PlaybookVM, sort: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (sort) {
    case 'name':
      return a.name.localeCompare(b.name) * sign;
    case 'state':
      return (stateRank(a.state) - stateRank(b.state)) * sign;
    case 'steps': {
      const av = a.stepCount ?? -1;
      const bv = b.stepCount ?? -1;
      return (av - bv) * sign || a.name.localeCompare(b.name);
    }
    case 'reliability': {
      const ar = successRate(a);
      const br = successRate(b);
      if (ar === null && br === null) return a.name.localeCompare(b.name);
      if (ar === null) return 1; // never-run always sorts last
      if (br === null) return -1;
      return (ar - br) * sign || a.name.localeCompare(b.name);
    }
    case 'lastRun':
    default: {
      const at = a.lastRun ? new Date(a.lastRun.startedAt).getTime() : Number.NEGATIVE_INFINITY;
      const bt = b.lastRun ? new Date(b.lastRun.startedAt).getTime() : Number.NEGATIVE_INFINITY;
      if (at === bt) return a.name.localeCompare(b.name);
      // No last run always sorts last, independent of direction.
      if (at === Number.NEGATIVE_INFINITY) return 1;
      if (bt === Number.NEGATIVE_INFINITY) return -1;
      return (at - bt) * sign;
    }
  }
}
