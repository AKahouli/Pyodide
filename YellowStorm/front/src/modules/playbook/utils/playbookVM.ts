import type { ExecutionScheduleData, PlaybookExecution, PlaybookExecutionSummary, PlaybookSummary } from '../types';
import { derivePurpose } from './derivePurpose';
import { computeNextRunAt } from './nextRunAt';
import { summarizeExecutionSchedule } from './scheduleDisplay';

/**
 * Adapter from the raw list item (the backend returns the whole flow doc —
 * `nodes`, `triggerConfig`, `isFavorite` — plus `executionStatus` /
 * `lastExecutionAt` overlays) to the console view model (spec §5.1).
 * Console components consume `PlaybookVM` only.
 */

export type RunOutcome = 'succeeded' | 'failed' | 'cancelled' | 'running';

export type PlaybookState =
  | 'running' | 'queued' | 'pending' | 'awaiting_approval'
  | 'interrupted' | 'failed' | 'completed' | 'cancelled' | 'idle';

export type TriggerKind = 'manual' | 'schedule' | 'mail';

/** The raw list payload is wider than `PlaybookSummary`; the extra fields are real. */
export interface RawPlaybookListItem extends PlaybookSummary {
  nodes?: Array<{ id: string; kind?: string; label?: string }> | null;
  triggerConfig?: { kind?: string | null; params?: Record<string, unknown> | null } | null;
  ownerId?: string;
  workspaces?: string[];
}

export interface PlaybookVM {
  id: string;
  name: string;
  purpose: string;
  purposeIsDerived: boolean;
  state: PlaybookState;
  stepCount: number | null;
  labels: string[];
  isFavorite: boolean;
  workspaceId: string;
  trigger: { kind: TriggerKind; label: string; nextRunAt: string | null };
  lastRun: { id: string; outcome: RunOutcome; startedAt: string; durationMs: number | null } | null;
  /** null = history not loaded yet (degradation); [] = never run. */
  history: RunOutcome[] | null;
  live?: {
    runId: string;
    currentStepIndex: number;
    currentStepName: string;
    startedAt: string;
    progressPct: number | null;
    queuePosition?: number | null;
    /** taskId → step status for the running execution (drawer step marks). */
    stepStatuses: Record<string, string>;
  };
  approval?: {
    runId: string;
    nodeName: string;
    summary: string;
    blockedSince: string;
    taskId: string;
    interruptId?: string;
  };
  failure?: { runId: string; message: string };
  duplicateOfId?: string;
  isEmptyDraft?: boolean;
  /** Node labels for the drawer's step list. */
  nodes: Array<{ id: string; label: string }>;
  /** Recent runs, newest first, max 6 (drawer). */
  recentRuns: Array<{ id: string; executionNumber: number; outcome: RunOutcome; durationMs: number | null; startedAt: string }>;
  integrationToken?: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface PlaybookVMContext {
  /** Cached live execution for the playbook (SSE-hydrated), when one is active. */
  liveExecution?: PlaybookExecution | null;
  /** Last N execution summaries, newest first, when history has been loaded. */
  history?: PlaybookExecutionSummary[] | null;
}

// ---- state precedence (spec §6.2) ----

const STATE_ORDER: Record<PlaybookState, number> = {
  running: 0, queued: 1, pending: 2, awaiting_approval: 3, interrupted: 4,
  failed: 5, cancelled: 6, completed: 7, idle: 8,
};

const EXECUTION_TO_STATE: Record<string, PlaybookState> = {
  running: 'running', queued: 'queued', pending: 'pending',
  pending_approval: 'awaiting_approval', interrupted: 'interrupted',
  failed: 'failed', cancelled: 'cancelled', completed: 'completed',
};

const OUTCOME_BY_STATE: Record<string, RunOutcome> = {
  completed: 'succeeded', failed: 'failed', cancelled: 'cancelled',
  running: 'running', queued: 'running', pending: 'running',
  pending_approval: 'running', interrupted: 'failed',
};

// ---- labels (spec §6.4) — derived, non-editable; single file to swap for real tags ----

const LABEL_KEYWORDS: Array<[label: string, keywords: string[]]> = [
  ['Finance', ['financ', 'budget', 'écart', 'ecart', 'atterrissage', 'pnb', 'cfo', 'rapport', 'états financiers', 'etats financiers']],
  ['RH', ['cv', 'resume', 'recrut', 'candidat']],
  ['Doc', ['pdf', 'docx', 'excel', 'xlsx', 'template', 'export']],
  ['Lead gen', ['lead', 'prospect', 'diagnostic client']],
  ['Contenu', ['flyer', 'social', 'calendar', 'calendrier', 'feedback', 'content']],
  ['Sécurité', ['injection', 'alert', 'sécurit', 'securit', 'security']],
];

function deriveLabels(name: string, purpose: string): string[] {
  const haystack = `${name} ${purpose}`.toLowerCase();
  const labels: string[] = [];
  for (const [label, keywords] of LABEL_KEYWORDS) {
    if (keywords.some((k) => haystack.includes(k))) labels.push(label);
  }
  return labels.slice(0, 3);
}

// ---- duplicate detection (spec §6.3) — advisory only ----

const NAME_NOISE = /\s*\((?:\d+|copy)\)|\s*[- ](?:copy)$/gi;

function canonicalTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(NAME_NOISE, '')
    .replace(/[^a-z0-9à-ÿ\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

// Generic filler words so "Lead Gen Pipeline" ≈ "lead gen workflow" (spec §15.1).
const STOPWORDS = new Set(['use', 'case', 'with', 'and', 'the', 'of', 'a', 'workflow', 'pipeline']);

function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a));
}

/** Overlap coefficient with prefix stemming ("gen" matches "generation"). */
export function nameSimilarity(a: string, b: string): number {
  const ta = canonicalTokens(a);
  const tb = canonicalTokens(b);
  if (!ta.length || !tb.length) return 0;
  let matched = 0;
  for (const x of ta) {
    if (tb.some((y) => tokenMatch(x, y))) matched++;
  }
  return matched / Math.min(ta.length, tb.length);
}

function sameCanonical(a: string, b: string): boolean {
  return canonicalTokens(a).join(' ') === canonicalTokens(b).join(' ');
}

/**
 * Advisory duplicate detection (spec §6.3): groups names that are canonically
 * equal or ≥0.8 similar; in each group every member except the most recently
 * updated gets `duplicateOfId = keeper id`. Never deletes anything.
 * ponytail: O(n²) pairwise scan — fine to ~1k playbooks; upgrade to indexed
 * grouping if workspaces grow past that.
 */
export function markDuplicates<T extends { id: string; name: string; updatedAt: string }>(items: T[]): Map<string, string> {
  const parent = new Map<string, string>(items.map((i) => [i.id, i.id] as const));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (sameCanonical(items[i].name, items[j].name) || nameSimilarity(items[i].name, items[j].name) >= 0.8) {
        union(items[i].id, items[j].id);
      }
    }
  }
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const root = find(item.id);
    const group = groups.get(root) ?? [];
    group.push(item);
    groups.set(root, group);
  }
  const duplicates = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keeper = group.reduce((best, item) => (item.updatedAt > best.updatedAt ? item : best));
    for (const item of group) {
      if (item.id !== keeper.id) duplicates.set(item.id, keeper.id);
    }
  }
  return duplicates;
}

// ---- trigger ----

function toSchedule(params: Record<string, unknown> | null | undefined): ExecutionScheduleData | null {
  if (!params) return null;
  return {
    enabled: Boolean(params.enabled),
    timezone: typeof params.timezone === 'string' ? params.timezone : 'UTC',
    type: (params.scheduleType ?? params.type) as ExecutionScheduleData['type'],
    lastScheduledRunAt: typeof params.lastScheduledRunAt === 'string' ? params.lastScheduledRunAt : null,
    daily: (params.daily as ExecutionScheduleData['daily']) ?? null,
    weekly: (params.weekly as ExecutionScheduleData['weekly']) ?? null,
    monthly: (params.monthly as ExecutionScheduleData['monthly']) ?? null,
    advanced: (params.advanced as ExecutionScheduleData['advanced']) ?? null,
  };
}

function deriveTrigger(raw: RawPlaybookListItem): PlaybookVM['trigger'] {
  const kind = raw.triggerConfig?.kind;
  const params = raw.triggerConfig?.params;
  if (kind === 'schedule' && params?.enabled) {
    const schedule = toSchedule(params);
    return {
      kind: 'schedule',
      label: summarizeExecutionSchedule(schedule) || 'Schedule',
      nextRunAt: computeNextRunAt(schedule),
    };
  }
  if (kind === 'mail' && params?.enabled) {
    return { kind: 'mail', label: 'Mail', nextRunAt: null };
  }
  return { kind: 'manual', label: 'Manual', nextRunAt: null };
}

// ---- live / approval / failure overlays ----

const DONE_STEP = new Set(['completed', 'skipped', 'failed', 'cancelled']);

function deriveLive(execution: PlaybookExecution, stepCount: number | null): PlaybookVM['live'] {
  const tasks = [...(execution.taskResults ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const total = stepCount ?? tasks.length;
  const done = tasks.filter((t) => DONE_STEP.has(t.status)).length;
  const running = tasks.find((t) => t.status === 'running');
  const nextUp = tasks.find((t) => t.status === 'pending' || t.status === 'queued');
  return {
    runId: execution.id,
    currentStepIndex: Math.min(done + 1, Math.max(total, 1)),
    currentStepName: running?.nodeTitle ?? nextUp?.nodeTitle ?? '',
    startedAt: execution.startedAt ?? execution.createdAt,
    progressPct: total > 0 ? Math.round((done / total) * 100) : null,
    queuePosition: execution.queuePosition ?? null,
    stepStatuses: Object.fromEntries(tasks.map((t) => [t.taskId, t.status])),
  };
}

function deriveApproval(execution: PlaybookExecution): PlaybookVM['approval'] | undefined {
  const interrupt = execution.interruptPayload ?? execution.pendingInterrupts?.[0] ?? null;
  if (!interrupt) return undefined;
  return {
    runId: execution.id,
    nodeName: interrupt.taskTitle || interrupt.taskId,
    summary: interrupt.message || interrupt.taskDescription || '',
    blockedSince: execution.updatedAt,
    taskId: interrupt.taskId,
    interruptId: interrupt.interruptId,
  };
}

// ---- adapter ----

export function buildPlaybookVM(raw: RawPlaybookListItem, ctx: PlaybookVMContext = {}): PlaybookVM {
  const { purpose, purposeIsDerived } = derivePurpose(raw.description);

  const stepCount = Array.isArray(raw.nodes) ? raw.nodes.length : null;

  const liveExecution =
    ctx.liveExecution && EXECUTION_TO_STATE[ctx.liveExecution.status] !== undefined &&
    ['running', 'queued', 'pending', 'awaiting_approval', 'interrupted'].includes(EXECUTION_TO_STATE[ctx.liveExecution.status])
      ? ctx.liveExecution
      : null;

  const overlayState = raw.executionStatus ? EXECUTION_TO_STATE[raw.executionStatus] ?? 'idle' : 'idle';
  const state: PlaybookState = liveExecution
    ? EXECUTION_TO_STATE[liveExecution.status] ?? overlayState
    : overlayState;

  const history = ctx.history
    ? ctx.history.slice(0, 8).map((h) => OUTCOME_BY_STATE[h.status] ?? 'running').reverse()
    : null;

  const newest = ctx.history?.[0] ?? null;
  const lastRun = newest
    ? {
        id: newest.id,
        outcome: OUTCOME_BY_STATE[newest.status] ?? 'running',
        startedAt: newest.startedAt ?? newest.createdAt,
        durationMs: newest.durationMs,
      }
    : raw.lastExecutionAt && overlayState !== 'idle'
      ? { id: '', outcome: OUTCOME_BY_STATE[raw.executionStatus ?? ''] ?? 'running', startedAt: raw.lastExecutionAt, durationMs: null }
      : null;

  const vm: PlaybookVM = {
    id: raw.id,
    name: raw.name,
    purpose,
    purposeIsDerived,
    state,
    stepCount,
    labels: deriveLabels(raw.name, purpose),
    isFavorite: Boolean(raw.isFavorite),
    workspaceId: raw.workspaces?.[0] ?? '',
    trigger: deriveTrigger(raw),
    lastRun,
    history,
    nodes: (raw.nodes ?? []).map((n) => ({ id: n.id, label: n.label || n.id })),
    recentRuns: (ctx.history ?? []).slice(0, 6).map((h) => ({
      id: h.id,
      executionNumber: h.executionNumber,
      outcome: OUTCOME_BY_STATE[h.status] ?? 'running',
      durationMs: h.durationMs,
      startedAt: h.startedAt ?? h.createdAt,
    })),
    integrationToken: raw.integrationToken ?? null,
    updatedAt: raw.updatedAt,
    createdAt: raw.createdAt,
  };

  if (liveExecution) {
    if (state === 'awaiting_approval') vm.approval = deriveApproval(liveExecution);
    else if (['running', 'queued', 'pending'].includes(state)) vm.live = deriveLive(liveExecution, stepCount);
  }
  if ((state === 'failed' || state === 'interrupted') && lastRun?.id) {
    vm.failure = { runId: lastRun.id, message: newest?.error ?? '' };
  }
  vm.isEmptyDraft = (stepCount === 0 || stepCount === 1) && (history?.length ?? 0) === 0 && purpose === '';
  return vm;
}

// ---- derived selectors (spec §5.2) ----

export function successRate(p: PlaybookVM): number | null {
  if (!p.history) return null;
  const finished = p.history.filter((o) => o !== 'running');
  if (!finished.length) return null;
  return Math.round((finished.filter((o) => o === 'succeeded').length / finished.length) * 100);
}

export function neverRun(p: PlaybookVM): boolean {
  return (p.history?.length ?? 0) === 0 && p.lastRun === null;
}

export function isLive(p: PlaybookVM): boolean {
  return ['running', 'queued', 'pending', 'awaiting_approval', 'failed', 'interrupted'].includes(p.state);
}

export function stateRank(state: PlaybookState): number {
  return STATE_ORDER[state];
}
