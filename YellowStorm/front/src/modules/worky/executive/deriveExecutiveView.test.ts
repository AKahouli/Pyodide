import { describe, expect, it } from 'vitest';
import type { WorkyBoardResponse, WorkyMessage, WorkyTask } from '../types';
import { collectPendingApprovals, deriveExecutiveView } from './deriveExecutiveView';

const msg = (components: WorkyMessage['components']): WorkyMessage =>
  ({ id: 'm1', role: 'manager', content: '', createdAt: '2026-09-14T10:00:00.000Z', components }) as WorkyMessage;
const choice = (questionId: string, status: string) =>
  ({ id: questionId, type: 'choice', data: {
    schemaVersion: 1, questionId, status, prompt: 'Review send', presentation: 'quick_replies', selectionMode: 'single', submitBehavior: 'immediate',
    options: [{ id: 'approve', label: 'Approve', submitText: 'approve' }, { id: 'decline', label: 'Decline', submitText: 'decline' }],
  } }) as NonNullable<WorkyMessage['components']>[number];

describe('collectPendingApprovals', () => {
  it('keeps only ready confirm:: cards, deduped by questionId (latest wins)', () => {
    const messages = [
      msg([choice('confirm::a', 'ready'), choice('ask::x', 'ready')]),
      msg([choice('confirm::b', 'submitted')]),
      msg([choice('confirm::a', 'ready')]),
    ];
    expect(collectPendingApprovals(messages).map((a) => a.questionId)).toEqual(['confirm::a']);
  });

  it('removes an approval when a later copy of its choice is submitted', () => {
    expect(collectPendingApprovals([
      msg([choice('confirm::a', 'ready')]),
      msg([choice('confirm::a', 'submitted')]),
    ])).toEqual([]);
  });

  it('skips a malformed approval card instead of exposing it to the renderer', () => {
    const malformed = { id: 'bad', type: 'choice', data: { questionId: 'confirm::bad', status: 'ready' } } as NonNullable<WorkyMessage['components']>[number];
    expect(collectPendingApprovals([msg([malformed])])).toEqual([]);
  });

  it('feeds needsInput + needs_attention health through the model', () => {
    const view = deriveExecutiveView(board([]), undefined, [msg([choice('confirm::a', 'ready')])]);
    expect(view.pendingApprovals).toHaveLength(1);
    expect(view.summary.needsInput).toBe(1);
    expect(view.health).toBe('needs_attention');
  });
});

const task = (overrides: Partial<WorkyTask>): WorkyTask => ({
  id: 'task-1', streamId: 'stream-1', externalId: 'step-1', title: 'Task', description: '',
  lane: 'running', planningStatus: 'confirmed', executionState: 'running', priority: 'medium',
  assigneeType: 'unassigned', assigneeId: null, actionCategory: 'internal_analysis', dependsOn: [],
  wave: null, dependsOnStepIds: [], blockerReason: null, result: null, blockedReason: null,
  theoreticalDeadlineAt: null, startedAt: null, completedAt: null, durationMs: null,
  ...overrides,
});

const board = (tasks: WorkyTask[], overrides: Partial<WorkyBoardResponse> = {}): WorkyBoardResponse => ({
  streamId: 'stream-1',
  pendingClarifications: [],
  plan: { title: 'Plan', goal: 'Goal', status: 'running' },
  session: { status: 'running', activeInterruptId: null },
  ...overrides,
  lanes: tasks.reduce<WorkyBoardResponse['lanes']>((lanes, item) => {
    lanes[item.lane].push(item);
    return lanes;
  }, { backlog: [], ready: [], running: [], review: [], blocked: [], failed: [], done: [], canceled: [] }),
});

describe('deriveExecutiveView', () => {
  it('marks only the exact waiting-session interrupt as active', () => {
    const active = task({ id: 'a', kind: 'ask', lane: 'blocked', interruptId: 'ask:1', question: 'Market?' });
    const parked = task({ id: 'b', kind: 'ask', lane: 'blocked', interruptId: 'ask:2', question: 'Budget?' });
    const view = deriveExecutiveView(board([active, parked], { session: { status: 'waiting', activeInterruptId: 'ask:1' } }));
    expect(view.health).toBe('needs_attention');
    expect(view.runtimeAsks.map((ask) => [ask.taskId, ask.active])).toEqual([['a', true], ['b', false]]);
  });

  it('surfaces a runtime ask_user (execute step, blockedReason "ask") as an answerable ask card', () => {
    // an execute step that called ask_user: kind stays truthful, blockedReason='ask',
    // the dynamic question lives on task.question.
    const asking = task({ id: 'e', kind: 'execute', lane: 'blocked', blockedReason: 'ask',
      interruptId: 'r1_email', question: 'Quel destinataire ?' });
    const view = deriveExecutiveView(board([asking], { session: { status: 'waiting', activeInterruptId: 'r1_email' } }));
    expect(view.runtimeAsks.map((ask) => [ask.taskId, ask.question, ask.active]))
      .toEqual([['e', 'Quel destinataire ?', true]]);
    expect(view.currentWork[0].status).toBe('needs_input');
  });

  it('keeps an external await_reply on track and labels it separately', () => {
    const waiting = task({ kind: 'await_reply', lane: 'blocked', blockedReason: 'awaiting email reply' });
    const view = deriveExecutiveView(board([waiting], { session: { status: 'blocked', activeInterruptId: null } }));
    expect(view.health).toBe('on_track');
    expect(view.currentWork[0].status).toBe('waiting_external');
  });

  it('shows the remaining work and resolves only direct unfinished prerequisites by step ID', () => {
    const completed = task({ id: 'a', externalId: 'step-a', lane: 'done' });
    const blocked = task({ id: 'b', externalId: 'step-b', lane: 'failed' });
    const canceled = task({ id: 'd', externalId: 'step-d', lane: 'canceled' });
    const next = task({ id: 'c', externalId: 'step-c', lane: 'ready', dependsOnStepIds: ['step-a', 'step-b', 'step-d', 'missing'] });
    const view = deriveExecutiveView(board([completed, blocked, canceled, next]));
    expect(view.summary).toMatchObject({ completed: 1, blocked: 1, remaining: 2 });
    expect(view.currentWork.find((item) => item.task.id === 'c')).toMatchObject({
      status: 'pending',
      openPrerequisites: [{ id: 'b' }],
      canceledPrerequisites: 1,
      unavailablePrerequisites: 1,
    });
    expect(view.currentWork.find((item) => item.task.id === 'b')?.downstreamCount).toBe(1);
    expect(view.deliveryPaths.find((path) => path.task.id === 'c')).toMatchObject({ total: 4, completed: 1, blocked: 1, nextTask: { id: 'b' } });
  });

  it('selects a prerequisite before its ready successor and keeps paths with canceled children', () => {
    const first = task({ id: 'a', externalId: 'step-a', lane: 'ready' });
    const second = task({ id: 'b', externalId: 'step-b', lane: 'ready', dependsOnStepIds: ['step-a'] });
    const canceledChild = task({ id: 'c', externalId: 'step-c', lane: 'canceled', dependsOnStepIds: ['step-b'] });
    const paths = deriveExecutiveView(board([first, second, canceledChild])).deliveryPaths;
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ task: { id: 'b' }, nextTask: { id: 'a' } });
  });

  it.each([
    ['canceled', 'stopped'], ['completed', 'completed'], ['paused', 'paused'], ['failed', 'at_risk'],
  ] as const)('gives session status %s authoritative health %s', (status, health) => {
    expect(deriveExecutiveView(board([],{ session: { status, activeInterruptId: null } })).health).toBe(health);
  });

  it('uses cached persona identity for human delegation', () => {
    const view = deriveExecutiveView(board([task({ assigneeKey: 'directory-1', assigneeName: 'Emmanuel', assigneeRole: 'Senior Business', isPersona: true })]));
    expect(view.delegations[0]).toMatchObject({ name: 'Emmanuel', role: 'Senior Business', type: 'human' });
  });

  it('tolerates the old board response without plan or session', () => {
    const view = deriveExecutiveView(board([], { plan: undefined, session: undefined }), 'active');
    expect(view.health).toBe('planning');
    expect(view.plan).toBeNull();
    expect(view.session).toBeNull();
  });
});
