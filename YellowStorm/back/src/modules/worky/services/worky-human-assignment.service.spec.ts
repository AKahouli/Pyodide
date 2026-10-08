import { newObjectId } from '@common/postgres';
import { WorkyHumanAssignmentService } from './worky-human-assignment.service';
import type { WorkyStreamRecord, WorkyTaskRecord } from '../worky.types';

interface MakeOptions {
  taskAssigneeType?: string;
  taskAssigneeId?: string | null;
  userLookupResult?: unknown;
  searchUsersResult?: unknown;
  firstMail?: boolean;
}

const makeService = (options: MakeOptions = {}) => {
  const assigneeId = newObjectId();
  const stream = {
    id: newObjectId(),
    ownerUserId: newObjectId(),
    title: 'Q3 launch',
    artifactWorkspaceId: newObjectId(),
  } as WorkyStreamRecord;
  const task = {
    id: newObjectId(),
    streamId: stream.id,
    title: 'Review the design doc',
    description: '',
    theoreticalDeadlineAt: null,
    assigneeType: options.taskAssigneeType ?? 'unassigned',
    assigneeId: options.taskAssigneeId ?? null,
  } as WorkyTaskRecord;
  const tasks = {
    findById: jest.fn().mockResolvedValue(task),
    update: jest.fn().mockImplementation(async (_id: string, patch: Partial<WorkyTaskRecord>) => ({ ...task, ...patch })),
  };
  const streams = { findById: jest.fn().mockResolvedValue(stream) };
  const mail = { recordMail: jest.fn().mockResolvedValue(options.firstMail ?? true) };
  const emailService = { send: jest.fn().mockResolvedValue({ success: true }) };
  const userService = {
    findByEmail: jest.fn().mockResolvedValue(
      options.userLookupResult !== undefined
        ? options.userLookupResult
        : {
            _id: assigneeId,
            email: 'john@example.com',
            status: 'active',
            profile: { firstName: 'John', lastName: 'Doe' },
          },
    ),
    searchUsers: jest.fn().mockResolvedValue(
      options.searchUsersResult !== undefined
        ? options.searchUsersResult
        : [{ id: assigneeId, email: 'john@example.com', firstName: 'John', lastName: 'Doe' }],
    ),
  };
  const emitted: { type: string; payload: unknown }[] = [];
  const events = {
    emit: jest.fn((_userId: string, _streamId: string, e: { type: string; payload: unknown }) => {
      emitted.push({ type: e.type, payload: e.payload });
    }),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const scheduler = { schedule: jest.fn().mockResolvedValue({ id: newObjectId() }) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  const service = new WorkyHumanAssignmentService(
    streams as never,
    tasks as never,
    mail as never,
    emailService as never,
    userService as never,
    events as never,
    audit as never,
    scheduler as never,
    logger as never,
  );

  return { service, task, stream, tasks, streams, userService, emailService, mail, scheduler, emitted, audit, logger, assigneeId };
};

const baseHint = () => ({ kind: 'human' as const, reference: 'john@example.com' });

describe('WorkyHumanAssignmentService.assignFromHint', () => {
  it('assigns uniquely matched user, sends email, schedules reminders', async () => {
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { service, task, stream, tasks, mail, emailService, scheduler, emitted, audit, assigneeId } = makeService();
    const result = await service.assignFromHint({
      streamId: stream.id,
      taskId: task.id,
      hint: { ...baseHint(), dueAt: dueAt.toISOString() },
    });
    expect(result).toEqual({ status: 'assigned', taskId: task.id, assigneeId });
    expect(tasks.update).toHaveBeenCalledWith(task.id, {
      assigneeType: 'human_agent',
      assigneeId,
      theoreticalDeadlineAt: dueAt,
    });
    expect(mail.recordMail).toHaveBeenCalledWith({
      streamId: stream.id,
      taskId: task.id,
      kind: 'human_task.assigned',
      dedupKey: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(emailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'john@example.com' }));
    // The mail carries the deadline that was just set.
    expect(emailService.send.mock.calls[0][0].text).toContain(`Deadline: ${dueAt.toISOString()}`);
    // One reminder + one deadline = 2 schedule calls
    expect(scheduler.schedule).toHaveBeenCalledTimes(2);
    expect(scheduler.schedule.mock.calls[0][0]).toMatchObject({ streamId: stream.id, taskId: task.id, eventType: 'human_task.reminder' });
    expect(scheduler.schedule.mock.calls[1][0]).toMatchObject({ eventType: 'human_task.deadline', fireAt: dueAt });
    expect(emitted.find((e) => e.type === 'human_task.assigned')).toBeDefined();
    expect(emitted.find((e) => e.type === 'task.updated')).toBeDefined();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'human_task.assigned' }),
    );
  });

  it('returns ambiguous when multiple users match the reference, and leaves the task alone', async () => {
    const { service, task, stream, tasks, emailService, audit } = makeService({
      userLookupResult: null,
      searchUsersResult: [
        { id: newObjectId(), email: 'a@x.com', firstName: 'John', lastName: 'Doe' },
        { id: newObjectId(), email: 'b@x.com', firstName: 'John', lastName: 'Smith' },
      ],
    });
    const result = await service.assignFromHint({
      streamId: stream.id,
      taskId: task.id,
      hint: { kind: 'human', reference: 'John' },
    });
    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
    expect(tasks.update).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'human_task.ambiguous' }),
    );
  });

  it('returns unresolved when no user matches the reference', async () => {
    const { service, task, stream, tasks, audit } = makeService({
      userLookupResult: null,
      searchUsersResult: [],
    });
    const result = await service.assignFromHint({
      streamId: stream.id,
      taskId: task.id,
      hint: { kind: 'human', reference: 'Nobody' },
    });
    expect(result.status).toBe('unresolved');
    expect(tasks.update).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'human_task.unresolved' }),
    );
  });

  it('is idempotent when the task is already assigned to the same user', async () => {
    const assigneeId = newObjectId();
    const { service, task, stream, tasks, emailService, scheduler, mail } = makeService({
      taskAssigneeType: 'human_agent',
      taskAssigneeId: assigneeId,
      userLookupResult: { _id: assigneeId, email: 'john@example.com', status: 'active' },
    });
    const result = await service.assignFromHint({ streamId: stream.id, taskId: task.id, hint: baseHint() });
    expect(result).toEqual({ status: 'assigned', taskId: task.id, assigneeId });
    expect(tasks.update).not.toHaveBeenCalled();
    expect(mail.recordMail).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it('reassigns a human task when the hint names someone else', async () => {
    // The old idempotence check compared the assignee with itself, so any assigned task
    // short-circuited; now only the same person does.
    const { service, task, stream, tasks, emailService, assigneeId } = makeService({
      taskAssigneeType: 'human_agent',
      taskAssigneeId: newObjectId(),
    });
    const result = await service.assignFromHint({ streamId: stream.id, taskId: task.id, hint: baseHint() });
    expect(result).toEqual({ status: 'assigned', taskId: task.id, assigneeId });
    expect(tasks.update).toHaveBeenCalledWith(task.id, expect.objectContaining({ assigneeId }));
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('skips the email send and logs dedup when the ledger already holds the mail', async () => {
    const { service, task, stream, emailService, logger } = makeService({ firstMail: false });
    const result = await service.assignFromHint({ streamId: stream.id, taskId: task.id, hint: baseHint() });
    expect(result.status).toBe('assigned');
    expect(emailService.send).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Worky human-assignment: email already sent (ledger hit)',
      expect.objectContaining({ dedupKey: expect.any(String) }),
    );
  });

  it('propagates a ledger failure instead of treating it as already sent', async () => {
    const { service, task, stream, mail, emailService } = makeService();
    mail.recordMail.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(
      service.assignFromHint({ streamId: stream.id, taskId: task.id, hint: baseHint() }),
    ).rejects.toThrow('connection terminated');
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('throws when the task or the stream does not exist', async () => {
    const missingTask = makeService();
    missingTask.tasks.findById.mockResolvedValueOnce(null);
    await expect(
      missingTask.service.assignFromHint({ streamId: missingTask.stream.id, taskId: newObjectId(), hint: baseHint() }),
    ).rejects.toThrow(/task .* not found/);

    const missingStream = makeService();
    missingStream.streams.findById.mockResolvedValueOnce(null);
    await expect(
      missingStream.service.assignFromHint({ streamId: newObjectId(), taskId: missingStream.task.id, hint: baseHint() }),
    ).rejects.toThrow(/stream .* not found/);
  });
});

describe('WorkyHumanAssignmentService.applyHumanUpdate', () => {
  it('transitions the task lane + executionState and emits feedback event', async () => {
    const { service, task, tasks, streams, emitted, audit } = makeService({
      taskAssigneeType: 'human_agent',
      taskAssigneeId: newObjectId(),
    });
    const result = await service.applyHumanUpdate({
      taskId: task.id,
      actorUserId: newObjectId(),
      kind: 'feedback',
      comment: 'Looks good but needs a header',
    });
    expect(result.kind).toBe('feedback');
    expect(result.newLane).toBe('review');
    expect(result.newExecutionState).toBe('review');
    expect(tasks.update).toHaveBeenCalledWith(task.id, { executionState: 'review', lane: 'review' });
    // The stream comes from the task row when the caller does not give it.
    expect(streams.findById).toHaveBeenCalledWith(task.streamId);
    expect(emitted.find((e) => e.type === 'human_task.feedback_submitted')).toBeDefined();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'human_task.update',
        details: expect.objectContaining({ kind: 'feedback' }),
      }),
    );
  });

  it('throws when the task is not a human task', async () => {
    const { service, task, tasks } = makeService({ taskAssigneeType: 'ephemeral_ai_agent' });
    await expect(
      service.applyHumanUpdate({
        taskId: task.id,
        actorUserId: newObjectId(),
        kind: 'in_progress',
      }),
    ).rejects.toThrow(/not a human task/);
    expect(tasks.update).not.toHaveBeenCalled();
  });

  it('transitions to done and emits human_task.completed', async () => {
    const { service, task, emitted } = makeService({
      taskAssigneeType: 'human_agent',
      taskAssigneeId: newObjectId(),
    });
    const result = await service.applyHumanUpdate({
      taskId: task.id,
      actorUserId: newObjectId(),
      kind: 'done',
    });
    expect(result.newLane).toBe('done');
    expect(emitted.find((e) => e.type === 'human_task.completed')).toBeDefined();
  });
});
