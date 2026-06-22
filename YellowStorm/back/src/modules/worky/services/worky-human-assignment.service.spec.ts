import { Types } from 'mongoose';
import { WorkyHumanAssignmentService } from './worky-human-assignment.service';

interface MakeOptions {
  taskAssigneeType?: string;
  taskAssigneeId?: Types.ObjectId | null;
  userLookupResult?: unknown;
  searchUsersResult?: unknown;
  shareResult?: unknown;
  emailResult?: unknown;
  ledgerError?: Error | null;
  schedulerRows?: unknown[];
}

const makeService = (options: MakeOptions = {}) => {
  const taskObjectId = new Types.ObjectId();
  const streamObjectId = new Types.ObjectId();
  const ownerObjectId = new Types.ObjectId();
  const assigneeObjectId = new Types.ObjectId();

  const task = {
    _id: taskObjectId,
    streamId: streamObjectId,
    title: 'Review the design doc',
    description: '',
    theoreticalDeadlineAt: null,
    assigneeType: options.taskAssigneeType ?? 'unassigned',
    assigneeId: options.taskAssigneeId ?? null,
    set: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const tasks = {
    findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(task) }),
    updateOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
    }),
  };
  const stream = {
    _id: streamObjectId,
    ownerUserId: ownerObjectId,
    title: 'Q3 launch',
    artifactWorkspaceId: new Types.ObjectId(),
  };
  const streams = {
    findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(stream) }),
  };
  const mailLedger = {
    create: jest
      .fn()
      .mockImplementation(() => {
        if (options.ledgerError) return Promise.reject(options.ledgerError);
        return Promise.resolve({ _id: new Types.ObjectId() });
      }),
  };
  const emailService = {
    send: jest.fn().mockResolvedValue(options.emailResult ?? { success: true }),
  };
  const shareService = {
    share: jest.fn().mockResolvedValue(options.shareResult ?? { shared: [] }),
  };
  const userService = {
    findByEmail: jest
      .fn()
      .mockResolvedValue(
        options.userLookupResult !== undefined
          ? options.userLookupResult
          : {
              _id: assigneeObjectId,
              email: 'john@example.com',
              status: 'active',
              profile: { firstName: 'John', lastName: 'Doe' },
            },
      ),
    searchUsers: jest.fn().mockResolvedValue(
      options.searchUsersResult !== undefined
        ? options.searchUsersResult
        : [
            {
              id: assigneeObjectId.toString(),
              email: 'john@example.com',
              firstName: 'John',
              lastName: 'Doe',
            },
          ],
    ),
  };
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const events = {
    emit: jest.fn((_userId: string, _streamId: string, e: { type: string; payload: unknown }) => {
      emitted.push({ type: e.type, payload: e.payload });
    }),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const schedulerRows: unknown[] = [];
  const scheduler = {
    schedule: jest.fn().mockImplementation((row: unknown) => {
      schedulerRows.push(row);
      return Promise.resolve({ _id: new Types.ObjectId() });
    }),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const service = new WorkyHumanAssignmentService(
    streams as any,
    tasks as any,
    mailLedger as any,
    emailService as any,
    shareService as any,
    userService as any,
    events as any,
    audit as any,
    scheduler as any,
    logger as any,
  );

  return {
    service,
    task,
    stream,
    tasks,
    userService,
    shareService,
    emailService,
    mailLedger,
    scheduler,
    emitted,
    audit,
    schedulerRows,
  };
};

const baseHint = () => ({ kind: 'human' as const, reference: 'john@example.com' });

describe('WorkyHumanAssignmentService.assignFromHint', () => {
  it('assigns uniquely matched user, shares workspace, sends email, schedules reminders', async () => {
    const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { service, tasks, shareService, emailService, scheduler, emitted, audit } =
      makeService({});
    const result = await service.assignFromHint({
      streamId: new Types.ObjectId().toString(),
      taskId: new Types.ObjectId().toString(),
      hint: { ...baseHint(), dueAt: due },
    });
    expect(result.status).toBe('assigned');
    expect(result.assigneeId).toBeDefined();
    expect(tasks.updateOne).toHaveBeenCalled();
    expect(shareService.share).toHaveBeenCalled();
    expect(emailService.send).toHaveBeenCalled();
    // One reminder + one deadline = 2 schedule calls
    expect(scheduler.schedule).toHaveBeenCalledTimes(2);
    expect(scheduler.schedule.mock.calls[0][0].eventType).toBe('human_task.reminder');
    expect(scheduler.schedule.mock.calls[1][0].eventType).toBe('human_task.deadline');
    expect(emitted.find((e) => e.type === 'human_task.assigned')).toBeDefined();
    expect(emitted.find((e) => e.type === 'task.updated')).toBeDefined();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'human_task.assigned' }),
    );
  });

  it('returns ambiguous and rolls back when multiple users match the reference', async () => {
    const { service, tasks, emitted, audit } = makeService({
      userLookupResult: null,
      searchUsersResult: [
        { id: new Types.ObjectId().toString(), email: 'a@x.com', firstName: 'John', lastName: 'Doe' },
        { id: new Types.ObjectId().toString(), email: 'b@x.com', firstName: 'John', lastName: 'Smith' },
      ],
    });
    const result = await service.assignFromHint({
      streamId: new Types.ObjectId().toString(),
      taskId: new Types.ObjectId().toString(),
      hint: { kind: 'human', reference: 'John' },
    });
    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'human_task.ambiguous' }),
    );
  });

  it('returns unresolved when no user matches the reference', async () => {
    const { service, audit } = makeService({
      userLookupResult: null,
      searchUsersResult: [],
    });
    const result = await service.assignFromHint({
      streamId: new Types.ObjectId().toString(),
      taskId: new Types.ObjectId().toString(),
      hint: { kind: 'human', reference: 'Nobody' },
    });
    expect(result.status).toBe('unresolved');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'human_task.unresolved' }),
    );
  });

  it('is idempotent when the task is already assigned to the same user', async () => {
    const assigneeId = new Types.ObjectId();
    const { service, emailService, scheduler } = makeService({
      taskAssigneeType: 'human_agent',
      taskAssigneeId: assigneeId,
    });
    const result = await service.assignFromHint({
      streamId: new Types.ObjectId().toString(),
      taskId: new Types.ObjectId().toString(),
      hint: baseHint(),
    });
    expect(result.status).toBe('assigned');
    expect(emailService.send).not.toHaveBeenCalled();
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it('skips email send and logs dedup when ledger unique-index collides', async () => {
    const { service, emailService } = makeService({
      ledgerError: { name: 'MongoServerError', code: 11000, message: 'duplicate key' } as Error,
    });
    await service.assignFromHint({
      streamId: new Types.ObjectId().toString(),
      taskId: new Types.ObjectId().toString(),
      hint: baseHint(),
    });
    expect(emailService.send).not.toHaveBeenCalled();
  });
});

describe('WorkyHumanAssignmentService.applyHumanUpdate', () => {
  it('transitions the task lane + executionState and emits feedback event', async () => {
    const { service, tasks, emitted, audit } = makeService({
      taskAssigneeType: 'human_agent',
      taskAssigneeId: new Types.ObjectId(),
    });
    const result = await service.applyHumanUpdate({
      taskId: new Types.ObjectId().toString(),
      actorUserId: new Types.ObjectId().toString(),
      kind: 'feedback',
      comment: 'Looks good but needs a header',
    });
    expect(result.kind).toBe('feedback');
    expect(result.newLane).toBe('review');
    expect(result.newExecutionState).toBe('review');
    expect(tasks.updateOne).toHaveBeenCalled();
    expect(emitted.find((e) => e.type === 'human_task.feedback_submitted')).toBeDefined();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'human_task.update',
        details: expect.objectContaining({ kind: 'feedback' }),
      }),
    );
  });

  it('throws when the task is not a human task', async () => {
    const { service } = makeService({ taskAssigneeType: 'ephemeral_ai_agent' });
    await expect(
      service.applyHumanUpdate({
        taskId: new Types.ObjectId().toString(),
        actorUserId: new Types.ObjectId().toString(),
        kind: 'in_progress',
      }),
    ).rejects.toThrow(/not a human task/);
  });

  it('transitions to done and emits human_task.completed', async () => {
    const { service, emitted } = makeService({
      taskAssigneeType: 'human_agent',
      taskAssigneeId: new Types.ObjectId(),
    });
    const result = await service.applyHumanUpdate({
      taskId: new Types.ObjectId().toString(),
      actorUserId: new Types.ObjectId().toString(),
      kind: 'done',
    });
    expect(result.newLane).toBe('done');
    expect(emitted.find((e) => e.type === 'human_task.completed')).toBeDefined();
  });
});
