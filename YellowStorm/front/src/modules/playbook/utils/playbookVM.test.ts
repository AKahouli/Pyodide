import { describe, expect, it } from 'vitest';
import {
  buildPlaybookVM,
  markDuplicates,
  neverRun,
  stateRank,
  successRate,
  type RawPlaybookListItem,
} from './playbookVM';
import type { PlaybookExecution, PlaybookExecutionSummary } from '../types';

function raw(overrides: Partial<RawPlaybookListItem> = {}): RawPlaybookListItem {
  return {
    id: 'p1',
    name: 'Lead Generation',
    description: 'Trouve des leads. Autres détails.',
    taskCount: 0,
    isFavorite: false,
    scheduleEnabled: false,
    executionStatus: null,
    lastExecutionAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
    triggerConfig: null,
    ...overrides,
  };
}

function execution(status: PlaybookExecution['status'], overrides: Partial<PlaybookExecution> = {}): PlaybookExecution {
  return {
    id: 'e1',
    playbookId: 'p1',
    status,
    taskResults: [],
    interruptPayload: null,
    error: null,
    durationMs: null,
    startedAt: '2026-03-01T10:00:00.000Z',
    completedAt: null,
    threadId: null,
    playbookSnapshot: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  } as PlaybookExecution;
}

function summary(status: PlaybookExecutionSummary['status'], overrides: Partial<PlaybookExecutionSummary> = {}): PlaybookExecutionSummary {
  return {
    id: 'r1',
    playbookId: 'p1',
    executedBy: 'u1',
    executionNumber: 1,
    status,
    error: null,
    durationMs: 5000,
    startedAt: '2026-03-01T10:00:00.000Z',
    completedAt: '2026-03-01T10:00:05.000Z',
    singleStepTaskId: null,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:05.000Z',
    ...overrides,
  };
}

describe('buildPlaybookVM', () => {
  it('computes stepCount from nodes (B1 fix) and renders null when absent', () => {
    expect(buildPlaybookVM(raw()).stepCount).toBe(3);
    expect(buildPlaybookVM(raw({ nodes: undefined })).stepCount).toBeNull();
  });

  it('maps the execution-status overlay to console states', () => {
    expect(buildPlaybookVM(raw({ executionStatus: 'pending_approval', lastExecutionAt: '2026-03-01T10:00:00.000Z' })).state).toBe('awaiting_approval');
    expect(buildPlaybookVM(raw({ executionStatus: null })).state).toBe('idle');
    expect(buildPlaybookVM(raw({ executionStatus: 'completed', lastExecutionAt: '2026-03-01T10:00:00.000Z' })).lastRun?.outcome).toBe('succeeded');
  });

  it('state precedence: a live running execution wins over a stale overlay (§6.2)', () => {
    const vm = buildPlaybookVM(raw({ executionStatus: 'failed' }), { liveExecution: execution('running') });
    expect(vm.state).toBe('running');
    expect(vm.live?.runId).toBe('e1');
    expect(stateRank('running')).toBeLessThan(stateRank('failed'));
  });

  it('derives approval details from the interrupt payload', () => {
    const vm = buildPlaybookVM(raw({ executionStatus: 'pending_approval' }), {
      liveExecution: execution('pending_approval', {
        interruptPayload: { type: 'human_approval', taskId: 'n2', taskTitle: 'Nœud 2 — Validation humaine', message: 'Valider le rapport avant envoi', threadId: 't1' },
        updatedAt: '2026-03-01T11:00:00.000Z',
      }),
    });
    expect(vm.state).toBe('awaiting_approval');
    expect(vm.approval?.nodeName).toBe('Nœud 2 — Validation humaine');
    expect(vm.approval?.summary).toBe('Valider le rapport avant envoi');
    expect(vm.approval?.taskId).toBe('n2');
  });

  it('uses the playbook step label instead of an internal ID for approval', () => {
    const pending = execution('pending_approval', {
      interruptPayload: { type: 'human_approval', taskId: 'n2', taskTitle: 'n2', message: 'Approve?', threadId: 't1' },
    });
    const labeled = buildPlaybookVM(raw({ executionStatus: 'pending_approval', nodes: [{ id: 'n2', label: 'Review report' }] }), { liveExecution: pending });
    expect(labeled.approval?.nodeName).toBe('Review report');
    const unnamed = buildPlaybookVM(raw({ executionStatus: 'pending_approval' }), { liveExecution: pending });
    expect(unnamed.approval?.nodeName).toBe('');
  });

  it('maps history (oldest→newest) and derives lastRun with duration', () => {
    const vm = buildPlaybookVM(raw(), {
      history: [
        summary('completed', { id: 'r2', durationMs: 9000 }),
        summary('failed', { id: 'r1', error: 'boom' }),
      ],
    });
    expect(vm.history).toEqual(['failed', 'succeeded']);
    expect(vm.lastRun).toEqual({ id: 'r2', outcome: 'succeeded', startedAt: '2026-03-01T10:00:00.000Z', durationMs: 9000 });
  });

  it('degrades safely when history is not loaded (§5.3)', () => {
    const vm = buildPlaybookVM(raw({ executionStatus: 'failed', lastExecutionAt: '2026-03-01T10:00:00.000Z' }));
    expect(vm.history).toBeNull();
    expect(successRate(vm)).toBeNull();
    expect(vm.lastRun?.outcome).toBe('failed');
  });

  it('derives trigger kind from triggerConfig', () => {
    const scheduled = buildPlaybookVM(raw({
      triggerConfig: { kind: 'schedule', params: { enabled: true, scheduleType: 'weekly', weekly: { slots: [{ weekday: 1, timeLocal: '09:00' }] } } },
    }));
    expect(scheduled.trigger.kind).toBe('schedule');
    expect(scheduled.trigger.nextRunAt).toBeTruthy();
    const manual = buildPlaybookVM(raw({ triggerConfig: { kind: 'schedule', params: { enabled: false } } }));
    expect(manual.trigger.kind).toBe('manual');
  });

  it('derives labels and flags empty drafts', () => {
    const vm = buildPlaybookVM(raw({ name: 'Rapport financier CFO', description: '', nodes: [] }));
    expect(vm.labels).toContain('Finance');
    expect(vm.purpose).toBe('');
    expect(vm.isEmptyDraft).toBe(true);
  });
});

describe('successRate / neverRun', () => {
  it('returns null for never-run and all-running histories', () => {
    const never = buildPlaybookVM(raw());
    expect(successRate(never)).toBeNull();
    expect(neverRun(never)).toBe(true);
    const allRunning = buildPlaybookVM(raw(), { history: [summary('running'), summary('queued')] });
    expect(successRate(allRunning)).toBeNull();
    expect(neverRun(allRunning)).toBe(false);
  });

  it('computes the rounded percentage over finished runs only', () => {
    const vm = buildPlaybookVM(raw(), {
      history: [summary('completed'), summary('failed'), summary('completed'), summary('running')],
    });
    expect(successRate(vm)).toBe(67);
  });
});

describe('markDuplicates (§6.3 / §15.1)', () => {
  it('groups the lead-gen family and the cv-classifier family', () => {
    const items = [
      { id: 'a', name: 'Lead Generation', updatedAt: '2026-03-05T00:00:00.000Z' },
      { id: 'b', name: 'Lead Generation Pipeline (2)', updatedAt: '2026-03-03T00:00:00.000Z' },
      { id: 'c', name: 'Lead Gen Pipeline (7)', updatedAt: '2026-03-01T00:00:00.000Z' },
      { id: 'd', name: 'lead gen workflow', updatedAt: '2026-03-02T00:00:00.000Z' },
      { id: 'e', name: 'CV Classifier', updatedAt: '2026-03-05T00:00:00.000Z' },
      { id: 'f', name: 'CV Classifier with DOCX Export', updatedAt: '2026-03-04T00:00:00.000Z' },
      { id: 'g', name: 'CV Classifier with DOCX and Excel Export', updatedAt: '2026-03-03T00:00:00.000Z' },
      { id: 'h', name: 'Use case Diagnostic Client', updatedAt: '2026-03-05T00:00:00.000Z' },
      { id: 'i', name: 'Use case Diagnostic Client (copy)', updatedAt: '2026-03-02T00:00:00.000Z' },
      { id: 'j', name: 'Use case Crisis Room', updatedAt: '2026-03-05T00:00:00.000Z' },
    ];
    const dup = markDuplicates(items);
    expect(dup.get('b')).toBe('a');
    expect(dup.get('c')).toBe('a');
    expect(dup.get('d')).toBe('a');
    expect(dup.get('f')).toBe('e');
    expect(dup.get('g')).toBe('e');
    expect(dup.get('i')).toBe('h');
    expect(dup.has('a')).toBe(false);
    expect(dup.has('e')).toBe(false);
    expect(dup.has('h')).toBe(false);
    expect(dup.has('j')).toBe(false);
  });
});
