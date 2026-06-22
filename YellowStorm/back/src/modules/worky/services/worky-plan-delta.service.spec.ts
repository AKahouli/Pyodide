import { Types } from 'mongoose';
import { WorkyPlanDeltaService } from './worky-plan-delta.service';

interface ApplyInput {
  streamId: string;
  basePlanVersion: number;
  triggerEventId: string;
  body: any;
  createdBy: string;
}

interface MakeOptions {
  stream?: any;
  existingTasks?: Array<{ _id: Types.ObjectId }>;
  streamUpdateReturn?: any;
  streamUpdateNull?: boolean;
  streamStatus?: string;
}

const makeService = (options: MakeOptions = {}) => {
  const streamObjectId = new Types.ObjectId();
  const stream = options.stream ?? {
    _id: streamObjectId,
    ownerUserId: new Types.ObjectId(),
    status: options.streamStatus ?? 'planning',
    currentPlanVersion: 0,
    budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
  };
  const streamModel = {
    findById: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(stream),
    }),
    findOneAndUpdate: jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue(
          options.streamUpdateNull ? null : { ...stream, currentPlanVersion: 1 },
        ),
    }),
  };
  const taskCreate = jest.fn((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc }));
  const tasks = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(
            (options.existingTasks ?? []).map((t) => ({ _id: t._id, title: 't' })),
          ),
        }),
      }),
    }),
    create: taskCreate,
    updateOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
    }),
    findOneAndUpdate: jest.fn((filter, update) => ({
      exec: jest.fn().mockResolvedValue({ _id: filter._id, ...update.$set }),
    })),
  };
  const planVersionCreate = jest.fn((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc }));
  const planVersions = { create: planVersionCreate };
  const planDeltaCreate = jest.fn((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc }));
  const planDeltas = {
    create: planDeltaCreate,
    findById: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    }),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true }) }),
  };
  const interactions = {
    create: jest.fn((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc })),
  };
  const humanAssignment = {
    assignFromHint: jest.fn().mockResolvedValue({ status: 'assigned' }),
  };
  const governance = {
    resolve: jest.fn().mockResolvedValue({ resolvedLevel: 'off', source: 'default' }),
  };
  const events = { emit: jest.fn() };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  // Add a chained streams lookup for the applyApproved path:
  // streamModel.findById(...).select({ownerUserId:1}).lean().exec()
  const ownerLeanExec = jest.fn().mockResolvedValue({ ownerUserId: stream.ownerUserId });
  (streamModel.findById as jest.Mock).mockImplementation(() => ({
    exec: jest.fn().mockResolvedValue(stream),
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: ownerLeanExec }),
    }),
  }));
  const service = new WorkyPlanDeltaService(
    streamModel as any,
    tasks as any,
    planVersions as any,
    planDeltas as any,
    interactions as any,
    humanAssignment as any,
    governance as any,
    events as any,
    logger as any,
  );
  return {
    service,
    taskCreate,
    planVersionCreate,
    planDeltaCreate,
    planDeltas,
    streams: streamModel,
    interactions,
    humanAssignment,
    stream,
    streamModel,
    events,
    governance,
  };
};

const baseInput = (overrides: Partial<ApplyInput> = {}): ApplyInput => ({
  streamId: new Types.ObjectId().toString(),
  basePlanVersion: 0,
  triggerEventId: 'evt-1',
  body: { create_tasks: [] },
  createdBy: new Types.ObjectId().toString(),
  ...overrides,
});

describe('WorkyPlanDeltaService.apply', () => {
  it('applies an empty delta as a no-op (audits, persists, no task changes)', async () => {
    const { service, taskCreate, planDeltaCreate } = makeService();
    const result = await service.apply(baseInput({ body: {} }));
    expect(taskCreate).not.toHaveBeenCalled();
    expect(planDeltaCreate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'applied', reason: 'empty delta' }),
    );
    expect(result.createdTaskIds).toEqual([]);
    expect(result.clarificationIds).toEqual([]);
  });

  it('creates tasks, increments plan version, and persists the delta + plan-version row', async () => {
    const { service, taskCreate, planDeltaCreate, planVersionCreate } = makeService();
    const result = await service.apply(
      baseInput({
        body: {
          create_tasks: [
            { title: 'A', lane: 'ready', actionCategory: 'internal_analysis' },
            { title: 'B', lane: 'ready', actionCategory: 'internal_analysis' },
          ],
        },
      }),
    );
    expect(taskCreate).toHaveBeenCalledTimes(2);
    expect(planDeltaCreate).toHaveBeenCalledTimes(1);
    expect(planVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ versionNumber: 1, phase: 'planning' }),
    );
    expect(result.createdTaskIds).toHaveLength(2);
    expect(result.resultPlanVersion).toBe(1);
  });

  it('defaults created tasks to ephemeral AI workers when assignee is omitted', async () => {
    const { service, taskCreate } = makeService();
    await service.apply(
      baseInput({
        body: {
          create_tasks: [
            { title: 'A', lane: 'ready', actionCategory: 'internal_analysis' },
          ],
        },
      }),
    );
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeType: 'ephemeral_ai_agent' }),
    );
  });

  it('rejects when the base plan version is stale', async () => {
    const { service } = makeService({ streamUpdateNull: true });
    await expect(
      service.apply(baseInput({ basePlanVersion: 99 })),
    ).rejects.toMatchObject({ code: 'ERR_3407' });
  });

  it('rejects when the stream is in an execution phase', async () => {
    const { service } = makeService({ stream: { ...makeService().stream, status: 'active' } });
    await expect(
      service.apply(baseInput()),
    ).rejects.toMatchObject({ code: 'ERR_3409' });
  });

  it('accepts a planning plan-delta when the stream is in start_validation_failed', async () => {
    // After Start Stream rejects an empty plan, the runtime must be
    // able to apply the follow-up plan delta on the next turn —
    // otherwise the stream is dead-ended and the owner must abandon
    // it. The plan-delta service shares the pre-execution phase
    // definition with the planning service. We include a real
    // `create_tasks` entry so the test exercises the full apply
    // path, not the no-op empty-body branch.
    const { service } = makeService({
      stream: { ...makeService().stream, status: 'start_validation_failed' },
    });
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
    const { service } = makeService();
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
    ).rejects.toMatchObject({ code: 'ERR_3408' });
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
    ).rejects.toMatchObject({ code: 'ERR_3406' });
  });

  it('allows update_tasks to recover an unassigned task', async () => {
    const existingTaskId = new Types.ObjectId();
    const { service } = makeService({ existingTasks: [{ _id: existingTaskId }] });
    const result = await service.apply(
      baseInput({
        body: {
          update_tasks: [
            { taskId: existingTaskId.toString(), assigneeType: 'ephemeral_ai_agent' },
          ],
        },
      }),
    );
    expect(result.updatedTaskIds).toEqual([existingTaskId.toString()]);
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
    ).rejects.toMatchObject({ code: 'ERR_3406' });
  });

  it('persists clarification interactions and resolves clientTaskId to task id', async () => {
    const { service, interactions, taskCreate } = makeService();
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
    expect(taskCreate).toHaveBeenCalledTimes(1);
    expect(interactions.create).toHaveBeenCalledTimes(1);
    const created = interactions.create.mock.calls[0]![0];
    expect(created.question).toBe('Which doc?');
    expect(created.status).toBe('pending');
    expect(created.blocksTaskIds).toHaveLength(1);
    expect(result.clarificationIds).toHaveLength(1);
  });

  it('cancels tasks by setting lane=canceled when the id is known', async () => {
    const existingId = new Types.ObjectId();
    const { service } = makeService({
      existingTasks: [{ _id: existingId }],
    });
    const result = await service.apply(
      baseInput({
        body: {
          cancel_tasks: [{ taskId: existingId.toString() }],
        },
      }),
    );
    expect(result.cancelledTaskIds).toEqual([existingId.toString()]);
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
    const { service, events, governance } = makeService({ streamStatus: 'active' });
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
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'replan.applied' }),
    );
    expect(governance.resolve).toHaveBeenCalledWith(
      expect.anything(),
      'internal_analysis',
      null,
    );
  });

  it('requires approval when any category resolves to approval', async () => {
    const { service, events, governance, planDeltaCreate, interactions } = makeService({
      streamStatus: 'active',
    });
    governance.resolve.mockResolvedValueOnce({ resolvedLevel: 'approval', source: 'workspace_policy' });
    const result = await service.applyReplan({
      ...baseInput(),
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
    const persistedDelta = planDeltaCreate.mock.calls[0]![0];
    expect(persistedDelta.status).toBe('pending_approval');
    const persistedInteraction = interactions.create.mock.calls[0]![0];
    expect(persistedInteraction.type).toBe('replan_review');
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'replan.approval_required' }),
    );
  });

  it('manual mode always requires approval', async () => {
    const { service } = makeService({ streamStatus: 'active' });
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
  });
});

describe('WorkyPlanDeltaService hardening (Part 4 §8)', () => {
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
    const planDeltaId = new Types.ObjectId();
    const streamObjectId = new Types.ObjectId();
    const ownerObjectId = new Types.ObjectId();
    const { service, planDeltas, streams, planDeltaCreate, events, interactions } = makeService({
      streamStatus: 'active',
      stream: {
        _id: streamObjectId,
        ownerUserId: ownerObjectId,
        status: 'active',
        currentPlanVersion: 2,
        budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
      },
    });
    // Override the planDeltas.findById to return a pending delta.
    planDeltas.findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: planDeltaId,
          streamId: streamObjectId,
          basePlanVersion: 2,
          triggerEventId: 'evt-1',
          status: 'pending_approval',
          body: { create_tasks: [] },
        }),
      }),
    });
    planDeltas.updateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true }) });
    const result = await service.applyApproved({
      planDeltaId: planDeltaId.toString(),
      approvedBy: ownerObjectId.toString(),
    });
    expect(result.status).toBe('auto_applied');
    expect(planDeltas.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_approval' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'applied' }) }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      ownerObjectId.toString(),
      streamObjectId.toString(),
      expect.objectContaining({ type: 'replan.applied' }),
    );
  });
});
