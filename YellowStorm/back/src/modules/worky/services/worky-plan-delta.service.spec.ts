import { newObjectId } from '@common/postgres';
import { WorkyPlanDeltaService } from './worky-plan-delta.service';
import type { WorkyPlanDeltaRecord, WorkyStreamRecord } from '../worky.types';

interface ApplyInput {
  streamId: string;
  basePlanVersion: number;
  triggerEventId: string;
  body: any;
  createdBy: string;
}

interface MakeOptions {
  streamStatus?: string;
  currentPlanVersion?: number;
  existingTaskIds?: string[];
  concurrentDeltaWins?: boolean;
}

const makeService = (options: MakeOptions = {}) => {
  const stream = {
    id: newObjectId(),
    ownerUserId: newObjectId(),
    status: options.streamStatus ?? 'planning',
    currentPlanVersion: options.currentPlanVersion ?? 0,
    budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
  } as WorkyStreamRecord;
  // Records transaction boundaries and the human-assignment hook, to check what ran where.
  const timeline: string[] = [];
  const db = {
    transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      timeline.push('begin');
      const result = await fn({});
      timeline.push('commit');
      return result;
    }),
  };
  const streams = {
    findById: jest.fn().mockResolvedValue(stream),
    advancePlanVersion: jest.fn().mockResolvedValue(!options.concurrentDeltaWins),
  };
  const tasks = {
    listIdsByStream: jest.fn().mockResolvedValue(options.existingTaskIds ?? []),
    create: jest.fn(async (input: Record<string, unknown>) => ({ id: newObjectId(), ...input })),
    updateInStream: jest.fn(async (id: string, streamId: string, patch: Record<string, unknown>) => ({ id, streamId, ...patch })),
    update: jest.fn(async (id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
  };
  const plans = {
    createDelta: jest.fn(async (input: Record<string, unknown>) => ({ id: newObjectId(), ...input })),
    createVersion: jest.fn(async (input: Record<string, unknown>) => ({ id: newObjectId(), ...input })),
    findDeltaById: jest.fn().mockResolvedValue(null),
    markApplied: jest.fn().mockResolvedValue(true),
  };
  const interactions = {
    create: jest.fn(async (input: Record<string, unknown>) => ({ id: newObjectId(), status: 'pending', ...input })),
  };
  const humanAssignment = {
    assignFromHint: jest.fn(async () => {
      timeline.push('assignFromHint');
      return { status: 'assigned' };
    }),
  };
  const governance = {
    resolve: jest.fn().mockResolvedValue({ resolvedLevel: 'off', source: 'default' }),
  };
  const events = { emit: jest.fn() };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const service = new WorkyPlanDeltaService(
    db as never,
    streams as never,
    tasks as never,
    plans as never,
    interactions as never,
    humanAssignment as never,
    governance as never,
    events as never,
    logger as never,
  );
  return { service, stream, db, timeline, streams, tasks, plans, interactions, humanAssignment, governance, events };
};

const baseInput = (overrides: Partial<ApplyInput> = {}): ApplyInput => ({
  streamId: newObjectId(),
  basePlanVersion: 0,
  triggerEventId: 'evt-1',
  body: { create_tasks: [] },
  createdBy: newObjectId(),
  ...overrides,
});

describe('WorkyPlanDeltaService.apply', () => {
  it('applies an empty delta as a no-op (audits, persists, no task changes)', async () => {
    const { service, tasks, plans, streams } = makeService();
    const result = await service.apply(baseInput({ body: {} }));
    expect(tasks.create).not.toHaveBeenCalled();
    expect(streams.advancePlanVersion).not.toHaveBeenCalled();
    expect(plans.createDelta).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'applied', reason: 'empty delta', resultPlanVersion: 0 }),
    );
    expect(result.createdTaskIds).toEqual([]);
    expect(result.clarificationIds).toEqual([]);
  });

  it('creates tasks, increments plan version, and persists the delta + plan-version row in one transaction', async () => {
    const { service, stream, db, streams, tasks, plans } = makeService();
    const input = baseInput({
      body: {
        create_tasks: [
          { title: 'A', lane: 'ready', actionCategory: 'internal_analysis' },
          { title: 'B', lane: 'ready', actionCategory: 'internal_analysis' },
        ],
      },
    });
    const result = await service.apply(input);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(streams.advancePlanVersion).toHaveBeenCalledWith(stream.id, 0);
    expect(tasks.create).toHaveBeenCalledTimes(2);
    expect(plans.createDelta).toHaveBeenCalledTimes(1);
    expect(plans.createDelta).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'applied', applyMode: 'auto', phase: 'planning', basePlanVersion: 0, resultPlanVersion: 1, createdBy: input.createdBy }),
    );
    expect(plans.createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ versionNumber: 1, phase: 'planning', summary: '+2 tasks', triggerEventId: 'evt-1' }),
    );
    expect(result.createdTaskIds).toHaveLength(2);
    expect(result.resultPlanVersion).toBe(1);
    expect(result.planDeltaId).toBe((await plans.createDelta.mock.results[0].value).id);
  });

  it('defaults created tasks to ephemeral AI workers when assignee is omitted', async () => {
    const { service, tasks } = makeService();
    await service.apply(
      baseInput({
        body: {
          create_tasks: [
            { title: 'A', lane: 'ready', actionCategory: 'internal_analysis' },
          ],
        },
      }),
    );
    expect(tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeType: 'ephemeral_ai_agent', planningStatus: 'confirmed', priority: 'medium' }),
    );
  });

  it('resolves dependsOn client ids to the ids of the tasks created before', async () => {
    const { service, tasks } = makeService();
    const result = await service.apply(
      baseInput({
        body: {
          create_tasks: [
            { clientTaskId: 'a', title: 'A', lane: 'ready', actionCategory: 'internal_analysis' },
            { clientTaskId: 'b', title: 'B', lane: 'ready', actionCategory: 'internal_analysis', dependsOn: ['a'] },
          ],
        },
      }),
    );
    expect(tasks.create.mock.calls[1][0]).toMatchObject({ dependsOn: [result.createdTaskIds[0]] });
  });

  it('rejects when the base plan version is stale', async () => {
    const { service } = makeService();
    await expect(
      service.apply(baseInput({ basePlanVersion: 99 })),
    ).rejects.toMatchObject({ code: 'ERR_3507' });
  });

  it('rejects with a stale-version conflict when a concurrent delta advanced the version first', async () => {
    const { service, tasks, plans } = makeService({ concurrentDeltaWins: true });
    await expect(
      service.apply(
        baseInput({ body: { create_tasks: [{ title: 'A', lane: 'ready', actionCategory: 'internal_analysis' }] } }),
      ),
    ).rejects.toMatchObject({ code: 'ERR_3507' });
    expect(tasks.create).not.toHaveBeenCalled();
    expect(plans.createDelta).not.toHaveBeenCalled();
  });

  it('rejects when the stream is in an execution phase', async () => {
    const { service } = makeService({ streamStatus: 'active' });
    await expect(
      service.apply(baseInput()),
    ).rejects.toMatchObject({ code: 'ERR_3509' });
  });

  it('rejects an unknown stream', async () => {
    const { service, streams } = makeService();
    streams.findById.mockResolvedValueOnce(null);
    await expect(service.apply(baseInput())).rejects.toMatchObject({ code: 'ERR_3500' });
  });

  it('accepts a planning plan-delta when the stream is in start_validation_failed', async () => {
    // After Start Stream rejects an empty plan, the runtime must be
    // able to apply the follow-up plan delta on the next turn —
    // otherwise the stream is dead-ended and the owner must abandon
    // it. The plan-delta service shares the pre-execution phase
    // definition with the planning service. We include a real
    // `create_tasks` entry so the test exercises the full apply
    // path, not the no-op empty-body branch.
    const { service } = makeService({ streamStatus: 'start_validation_failed' });
    const result = await service.apply(
      baseInput({
        body: {
          create_tasks: [
            {
              clientTaskId: 'recover-1',
              title: 'Recover with one task',
              lane: 'ready',
              actionCategory: 'internal_analysis',
            },
          ],
        },
      }),
    );
    expect(result).toMatchObject({
      streamId: expect.any(String),
      planDeltaId: expect.any(String),
      createdTaskIds: expect.any(Array),
    });
    expect(result.createdTaskIds.length).toBe(1);
  });

  it('rejects a cyclic dependency in the new subgraph', async () => {
    const { service, db } = makeService();
    await expect(
      service.apply(
        baseInput({
          body: {
            create_tasks: [
              { clientTaskId: 'a', title: 'A', lane: 'ready', actionCategory: 'internal_analysis', dependsOn: ['b'] },
              { clientTaskId: 'b', title: 'B', lane: 'ready', actionCategory: 'internal_analysis', dependsOn: ['a'] },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'ERR_3508' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a delta that references an unknown task', async () => {
    const { service } = makeService();
    await expect(
      service.apply(
        baseInput({
          body: {
            update_tasks: [{ taskId: '6512bd43d9ffa6fc01000000', title: 'Ghost' }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'ERR_3506' });
  });

  it('allows update_tasks to recover an unassigned task', async () => {
    const existingTaskId = newObjectId();
    const { service, stream, tasks } = makeService({ existingTaskIds: [existingTaskId] });
    const result = await service.apply(
      baseInput({
        body: {
          update_tasks: [
            { taskId: existingTaskId, assigneeType: 'ephemeral_ai_agent' },
          ],
        },
      }),
    );
    expect(tasks.updateInStream).toHaveBeenCalledWith(existingTaskId, stream.id, { assigneeType: 'ephemeral_ai_agent' });
    expect(result.updatedTaskIds).toEqual([existingTaskId]);
  });

  it('rejects a delta with a dependsOn that points nowhere', async () => {
    const { service } = makeService();
    await expect(
      service.apply(
        baseInput({
          body: {
            create_tasks: [
              {
                title: 'A',
                lane: 'ready',
                actionCategory: 'internal_analysis',
                dependsOn: ['missing'],
              },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'ERR_3506' });
  });

  it('persists clarification interactions and resolves clientTaskId to task id', async () => {
    const { service, stream, interactions, tasks } = makeService();
    const result = await service.apply(
      baseInput({
        body: {
          create_tasks: [
            { clientTaskId: 'a', title: 'A', lane: 'backlog', actionCategory: 'internal_analysis' },
          ],
          clarification_requests: [
            {
              question: 'Which doc?',
              blocksTaskClientIds: ['a'],
            },
          ],
        },
      }),
    );
    expect(tasks.create).toHaveBeenCalledTimes(1);
    expect(interactions.create).toHaveBeenCalledTimes(1);
    const createdTaskId = result.createdTaskIds[0];
    expect(interactions.create).toHaveBeenCalledWith({
      streamId: stream.id,
      taskId: createdTaskId,
      type: 'clarification',
      targetUserId: stream.ownerUserId,
      question: 'Which doc?',
      options: [],
      blockingScope: 'task',
      blocksTaskIds: [createdTaskId],
    });
    expect(result.clarificationIds).toHaveLength(1);
  });

  it('points a clarification at the first blocked task that exists in the stream (interactions.task_id is a foreign key)', async () => {
    const existingTaskId = newObjectId();
    const unknownTaskId = newObjectId();
    const { service, interactions } = makeService({ existingTaskIds: [existingTaskId] });
    await service.apply(
      baseInput({
        body: {
          clarification_requests: [
            { question: 'Which one?', blocksTaskIds: [unknownTaskId, existingTaskId.toUpperCase(), 'not-an-id'] },
            { question: 'Anything?', blocksTaskIds: [unknownTaskId] },
          ],
        },
      }),
    );
    expect(interactions.create.mock.calls[0][0]).toMatchObject({ taskId: existingTaskId, blocksTaskIds: [unknownTaskId, existingTaskId] });
    expect(interactions.create.mock.calls[1][0]).toMatchObject({ taskId: null, blocksTaskIds: [unknownTaskId] });
  });

  it('cancels tasks by setting lane=canceled when the id is known', async () => {
    const existingId = newObjectId();
    const { service, stream, tasks } = makeService({ existingTaskIds: [existingId] });
    const result = await service.apply(
      baseInput({
        body: {
          cancel_tasks: [{ taskId: existingId }],
        },
      }),
    );
    expect(tasks.updateInStream).toHaveBeenCalledWith(existingId, stream.id, {
      lane: 'canceled',
      controlState: 'stopped',
      executionState: 'canceled',
    });
    expect(result.cancelledTaskIds).toEqual([existingId]);
  });

  it('lets a failed write abort the whole delta, before any human is contacted', async () => {
    const { service, plans, humanAssignment } = makeService();
    plans.createVersion.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));
    await expect(
      service.apply(
        baseInput({
          body: {
            create_tasks: [
              { title: 'Review', lane: 'ready', actionCategory: 'internal_analysis', assigneeType: 'human_agent', assigneeHint: { kind: 'human', reference: 'john@example.com' } },
            ],
          },
        }),
      ),
    ).rejects.toThrow('duplicate key');
    expect(humanAssignment.assignFromHint).not.toHaveBeenCalled();
  });
});

describe('WorkyPlanDeltaService human assignment hook', () => {
  const humanTask = (title: string) => ({
    title,
    lane: 'ready',
    actionCategory: 'internal_analysis',
    assigneeType: 'human_agent',
    assigneeHint: { kind: 'human', reference: title },
  });

  it('assigns the humans after the delta committed', async () => {
    const { service, stream, timeline, humanAssignment, tasks } = makeService();
    const result = await service.apply(
      baseInput({ body: { create_tasks: [humanTask('john'), { title: 'AI', lane: 'ready', actionCategory: 'research' }] } }),
    );
    expect(timeline).toEqual(['begin', 'commit', 'assignFromHint']);
    expect(humanAssignment.assignFromHint).toHaveBeenCalledWith({
      streamId: stream.id,
      taskId: result.createdTaskIds[0],
      hint: { kind: 'human', reference: 'john' },
    });
    expect(tasks.update).not.toHaveBeenCalled();
  });

  it('rolls an unresolved or ambiguous assignment back to unassigned and asks the owner', async () => {
    const { service, stream, timeline, humanAssignment, tasks, interactions } = makeService();
    humanAssignment.assignFromHint
      .mockImplementationOnce(async () => ({ status: 'unresolved' }))
      .mockImplementationOnce(async () => ({ status: 'ambiguous' }));
    const result = await service.apply(baseInput({ body: { create_tasks: [humanTask('nobody'), humanTask('john')] } }));

    for (const [index, title] of ['nobody', 'john'].entries()) {
      const taskId = result.createdTaskIds[index];
      expect(tasks.update).toHaveBeenCalledWith(taskId, { assigneeType: 'unassigned', assigneeId: null, theoreticalDeadlineAt: null });
      expect(interactions.create).toHaveBeenCalledWith({
        streamId: stream.id,
        taskId,
        type: 'assignment_disambiguation',
        targetUserId: stream.ownerUserId,
        question: `Who should be assigned to "${title}"? Please clarify or invite the user.`,
        options: [],
        blockingScope: 'task',
        blocksTaskIds: [taskId],
      });
    }
    // The delta's transaction, then one small transaction per rollback.
    expect(timeline).toEqual(['begin', 'commit', 'begin', 'commit', 'begin', 'commit']);
    expect(result.clarificationIds).toEqual([]);
  });

  it('ignores a hint on a task that is not for a human', async () => {
    const { service, humanAssignment } = makeService();
    await service.apply(
      baseInput({ body: { create_tasks: [{ ...humanTask('john'), assigneeType: 'ephemeral_ai_agent' }] } }),
    );
    expect(humanAssignment.assignFromHint).not.toHaveBeenCalled();
  });
});

describe('WorkyPlanDeltaService.applyReplan', () => {
  it('rejects when stream is in pre-execution phase', async () => {
    const { service } = makeService();
    await expect(
      service.applyReplan({
        ...baseInput(),
        reason: 'test',
        applyMode: 'auto',
      }),
    ).rejects.toThrow(/Replan is only valid during execution/);
  });

  it('rejects when stream is terminal', async () => {
    const { service } = makeService({ streamStatus: 'completed' });
    await expect(
      service.applyReplan({
        ...baseInput(),
        reason: 'test',
        applyMode: 'auto',
      }),
    ).rejects.toThrow(/terminal stream/);
  });

  it('auto-applies when governance resolves all categories to off/notify', async () => {
    const { service, stream, events, governance, plans } = makeService({ streamStatus: 'active' });
    const result = await service.applyReplan({
      ...baseInput(),
      reason: 'replan-due-to-feedback',
      applyMode: 'auto',
      body: {
        create_tasks: [
          { clientTaskId: 'b', title: 'Follow-up', lane: 'ready', actionCategory: 'internal_analysis' },
        ],
      },
    });
    expect(result.status).toBe('auto_applied');
    expect(result.resultPlanVersion).toBe(1);
    expect(plans.createDelta).toHaveBeenCalledWith(expect.objectContaining({ phase: 'replan', applyMode: 'auto', status: 'applied' }));
    expect(events.emit).toHaveBeenCalledWith(
      stream.ownerUserId,
      stream.id,
      expect.objectContaining({ type: 'replan.applied' }),
    );
    expect(governance.resolve).toHaveBeenCalledWith(
      stream.id,
      'internal_analysis',
      null,
    );
  });

  it('requires approval when any category resolves to approval', async () => {
    const { service, stream, db, events, governance, plans, interactions, tasks } = makeService({
      streamStatus: 'active',
      currentPlanVersion: 3,
    });
    governance.resolve.mockResolvedValueOnce({ resolvedLevel: 'approval', source: 'workspace_policy' });
    const result = await service.applyReplan({
      ...baseInput({ basePlanVersion: 3 }),
      reason: 'add external send',
      applyMode: 'auto',
      body: {
        create_tasks: [
          { clientTaskId: 'b', title: 'Email to client', lane: 'ready', actionCategory: 'external_send' },
        ],
      },
    });
    expect(result.status).toBe('pending_approval');
    expect(result.blockingCategories).toContain('external_send');
    expect(tasks.create).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const persistedDelta = plans.createDelta.mock.calls[0]![0];
    expect(persistedDelta).toMatchObject({ status: 'pending_approval', applyMode: 'auto', phase: 'replan', resultPlanVersion: 3, reason: 'add external send' });
    const persistedInteraction = interactions.create.mock.calls[0]![0];
    expect(persistedInteraction).toMatchObject({
      type: 'replan_review',
      taskId: null,
      targetUserId: stream.ownerUserId,
      options: ['approve', 'reject'],
      metadata: { planDeltaId: result.planDeltaId },
    });
    expect(result.interactionId).toBe((await interactions.create.mock.results[0].value).id);
    expect(events.emit).toHaveBeenCalledWith(
      stream.ownerUserId,
      stream.id,
      expect.objectContaining({ type: 'replan.approval_required' }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      stream.ownerUserId,
      stream.id,
      expect.objectContaining({ type: 'replan.required' }),
    );
  });

  it('manual mode always requires approval', async () => {
    const { service, plans } = makeService({ streamStatus: 'active' });
    const result = await service.applyReplan({
      ...baseInput(),
      reason: 'manual',
      applyMode: 'manual',
      body: {
        create_tasks: [
          { clientTaskId: 'b', title: 'B', lane: 'ready', actionCategory: 'internal_analysis' },
        ],
      },
    });
    expect(result.status).toBe('pending_approval');
    expect(result.blockingCategories).toContain('manual_mode');
    expect(plans.createDelta).toHaveBeenCalledWith(expect.objectContaining({ applyMode: 'manual' }));
  });
});

describe('WorkyPlanDeltaService hardening (Part 4 §8)', () => {
  const pendingDelta = (streamId: string, over: Partial<WorkyPlanDeltaRecord> = {}): WorkyPlanDeltaRecord => ({
    id: newObjectId(),
    streamId,
    basePlanVersion: 2,
    resultPlanVersion: 2,
    phase: 'replan',
    triggerEventId: 'evt-1',
    status: 'pending_approval',
    applyMode: 'auto',
    reason: 'add external send',
    createdBy: newObjectId(),
    body: { create_tasks: [{ title: 'Email to client', lane: 'ready', actionCategory: 'external_send' }] },
    appliedAt: null,
    approvedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  it('rejects a stale basePlanVersion with 409 (event-replay safe)', async () => {
    const { service } = makeService();
    await expect(
      service.apply(
        baseInput({ basePlanVersion: 99 }),
      ),
    ).rejects.toThrow(/basePlanVersion/);
  });

  it('rejects replan when basePlanVersion is stale', async () => {
    const { service } = makeService({ streamStatus: 'active' });
    await expect(
      service.applyReplan({
        ...baseInput({ basePlanVersion: 99 }),
        reason: 'stale',
        applyMode: 'auto',
        body: { create_tasks: [] },
      }),
    ).rejects.toThrow(/basePlanVersion/);
  });

  it('applyApproved re-applies a pending_approval delta and emits replan.applied to the owner', async () => {
    // Regression: previously the approval path could not apply the
    // pending delta because the guard would re-fire; the owner
    // approval is now a one-shot bypass.
    const { service, stream, plans, streams, governance, events } = makeService({ streamStatus: 'active', currentPlanVersion: 2 });
    const delta = pendingDelta(stream.id);
    plans.findDeltaById.mockResolvedValueOnce(delta);
    const approvedBy = stream.ownerUserId;

    const result = await service.applyApproved({ planDeltaId: delta.id, approvedBy });

    expect(result).toMatchObject({ status: 'auto_applied', planDeltaId: delta.id, resultPlanVersion: 3 });
    expect(result.createdTaskIds).toHaveLength(1);
    expect(governance.resolve).not.toHaveBeenCalled();
    expect(streams.advancePlanVersion).toHaveBeenCalledWith(stream.id, 2);
    // The applied copy records how it got there; the pending row is marked applied.
    expect(plans.createDelta).toHaveBeenCalledWith(
      expect.objectContaining({ applyMode: 'pending_approval', status: 'applied', createdBy: approvedBy, triggerEventId: 'evt-1' }),
    );
    expect(plans.markApplied).toHaveBeenCalledWith(delta.id, { resultPlanVersion: 3, approvedBy });
    expect(events.emit).toHaveBeenCalledWith(
      stream.ownerUserId,
      stream.id,
      expect.objectContaining({ type: 'replan.applied', payload: { planDeltaId: delta.id, resultPlanVersion: 3 } }),
    );
  });

  it('applyApproved is idempotent on an applied delta and refuses a rejected one', async () => {
    const { service, stream, plans, streams } = makeService({ streamStatus: 'active' });
    const applied = pendingDelta(stream.id, { status: 'applied', resultPlanVersion: 5 });
    plans.findDeltaById.mockResolvedValueOnce(applied);
    expect(await service.applyApproved({ planDeltaId: applied.id, approvedBy: newObjectId() })).toEqual({
      status: 'auto_applied',
      planDeltaId: applied.id,
      resultPlanVersion: 5,
    });

    const rejected = pendingDelta(stream.id, { status: 'rejected' });
    plans.findDeltaById.mockResolvedValueOnce(rejected);
    expect(await service.applyApproved({ planDeltaId: rejected.id, approvedBy: newObjectId() })).toEqual({
      status: 'rejected',
      planDeltaId: rejected.id,
    });
    expect(streams.advancePlanVersion).not.toHaveBeenCalled();
    expect(plans.markApplied).not.toHaveBeenCalled();
  });

  it('applyApproved rejects an unknown delta', async () => {
    const { service } = makeService();
    await expect(service.applyApproved({ planDeltaId: newObjectId(), approvedBy: newObjectId() })).rejects.toMatchObject({
      code: 'ERR_3506',
    });
  });
});
