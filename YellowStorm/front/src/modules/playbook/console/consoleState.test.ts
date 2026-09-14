import { describe, expect, it } from 'vitest';
import type { PlaybookVM } from '../utils/playbookVM';
import { buildPlaybookVM, type RawPlaybookListItem } from '../utils/playbookVM';
import {
  comparePlaybooks, matchesPlaybook, parseConsoleState, segmentCounts, serializeConsoleState,
  type ConsoleState,
} from './consoleState';

function vm(overrides: Partial<RawPlaybookListItem> = {}): PlaybookVM {
  return buildPlaybookVM(raw(overrides), {});
}

function raw(overrides: Partial<RawPlaybookListItem> = {}): RawPlaybookListItem {
  return {
    id: 'p1',
    name: 'Alpha',
    description: 'A playbook.',
    taskCount: 0,
    isFavorite: false,
    scheduleEnabled: false,
    executionStatus: 'completed',
    lastExecutionAt: '2026-03-01T10:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    nodes: [{ id: 'n1' }, { id: 'n2' }],
    ...overrides,
  };
}

describe('URL state round-trip', () => {
  it('parses what it serializes', () => {
    const state: ConsoleState = {
      seg: 'live', q: 'lead', states: ['running', 'failed'], view: 'board',
      sort: 'steps', dir: 'asc', minSteps: 2, maxSteps: 8,
      dateField: 'createdAt', from: '2026-01-01', to: '2026-02-01', dupOnly: true,
    };
    const parsed = parseConsoleState(serializeConsoleState(state), null, 100);
    expect(parsed).toEqual(state);
  });

  it('defaults: seg=all, view=table, sort=lastRun desc', () => {
    const parsed = parseConsoleState(new URLSearchParams(), null, 100);
    expect(parsed.seg).toBe('all');
    expect(parsed.view).toBe('table');
    expect(parsed.sort).toBe('lastRun');
    expect(parsed.dir).toBe('desc');
  });

  it('defaults to cards for a small workspace with no stored preference', () => {
    expect(parseConsoleState(new URLSearchParams(), null, 5).view).toBe('cards');
    expect(parseConsoleState(new URLSearchParams(), null, 50).view).toBe('table');
  });

  it('stored view wins over count-based default, URL wins over storage', () => {
    expect(parseConsoleState(new URLSearchParams(), 'board', 5).view).toBe('board');
    expect(parseConsoleState(new URLSearchParams('view=cards'), 'board', 50).view).toBe('cards');
  });
});

describe('matchesPlaybook', () => {
  const base: ConsoleState = { ...parseConsoleState(new URLSearchParams(), null, 100) };

  it('filters on query across name, purpose and labels', () => {
    const item = { ...vm(), labels: ['Finance'] };
    expect(matchesPlaybook(item, { ...base, q: 'ALPHA' })).toBe(true);
    expect(matchesPlaybook(item, { ...base, q: 'finance' })).toBe(true);
    expect(matchesPlaybook(item, { ...base, q: 'zzz' })).toBe(false);
  });

  it('multi-select state chips are additive', () => {
    const running = vm(raw({ id: 'r', executionStatus: 'running' }));
    const failed = vm(raw({ id: 'f', executionStatus: 'failed' }));
    const states = ['running', 'failed'] as ConsoleState['states'];
    expect(matchesPlaybook(running, { ...base, states })).toBe(true);
    expect(matchesPlaybook(failed, { ...base, states })).toBe(true);
    expect(matchesPlaybook(vm(raw({ id: 'c', executionStatus: 'completed' })), { ...base, states })).toBe(false);
  });

  it('step range and duplicate filters apply', () => {
    const item = vm(); // 2 steps
    expect(matchesPlaybook(item, { ...base, minSteps: 3 })).toBe(false);
    expect(matchesPlaybook(item, { ...base, maxSteps: 1 })).toBe(false);
    expect(matchesPlaybook(item, { ...base, dupOnly: true })).toBe(false);
  });
});

describe('comparePlaybooks — every sortable column', () => {
  const a = vm(raw({ id: 'a', name: 'Aaa', executionStatus: 'completed', lastExecutionAt: '2026-03-01T10:00:00.000Z', nodes: [{ id: 'n1' }] }));
  const b = vm(raw({ id: 'b', name: 'Bbb', executionStatus: 'running', lastExecutionAt: '2026-03-02T10:00:00.000Z', nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] }));
  const never = vm(raw({ id: 'n', name: 'Nnn', executionStatus: null, lastExecutionAt: null }));

  it('name asc/desc', () => {
    expect(comparePlaybooks(a, b, 'name', 'asc')).toBeLessThan(0);
    expect(comparePlaybooks(a, b, 'name', 'desc')).toBeGreaterThan(0);
  });

  it('state follows §6.2 precedence (running first asc)', () => {
    expect(comparePlaybooks(b, a, 'state', 'asc')).toBeLessThan(0);
  });

  it('steps numeric', () => {
    expect(comparePlaybooks(a, b, 'steps', 'desc')).toBeGreaterThan(0);
    expect(comparePlaybooks(a, b, 'steps', 'asc')).toBeLessThan(0);
  });

  it('lastRun sorts by date; never-run always last regardless of direction', () => {
    expect(comparePlaybooks(b, a, 'lastRun', 'desc')).toBeLessThan(0);
    expect(comparePlaybooks(never, a, 'lastRun', 'desc')).toBeGreaterThan(0);
    expect(comparePlaybooks(never, a, 'lastRun', 'asc')).toBeGreaterThan(0);
  });
});

describe('segmentCounts', () => {
  it('counts each segment', () => {
    const items = [
      vm(raw({ id: 'a', executionStatus: 'running', isFavorite: true })),
      vm(raw({ id: 'b', executionStatus: null, lastExecutionAt: null })),
    ];
    const counts = segmentCounts(items);
    expect(counts.all).toBe(2);
    expect(counts.live).toBe(1);
    expect(counts.fav).toBe(1);
    expect(counts.never).toBe(1);
    expect(counts.scheduled).toBe(0);
  });
});
