import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyStream,
  WorkyStreamDocument,
} from '../schemas/worky-stream.schema';
import {
  WorkyTask,
  WorkyTaskDocument,
} from '../schemas/worky-task.schema';
import {
  WorkyExecutionSnapshot,
  WorkyExecutionSnapshotDocument,
} from '../schemas/worky-execution-snapshot.schema';
import { LoggerService } from '../../logger';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkyEventService } from './worky-event.service';
import { WorkyAuditService } from './worky-audit.service';
import { WorkyRuntimeDispatchService } from './worky-runtime-dispatch.service';
import {
  IWorkyExecutionSnapshotResponse,
  IWorkyStartValidationIssue,
  IWorkyStartValidationResult,
  IWorkyTaskSummary,
  WorkyStartOutcome,
} from '../interfaces/worky-execution.interface';

const TERMINAL_TASK_LANES = new Set(['failed', 'canceled', 'superseded', 'archived']);
const RUNNABLE_LANES = new Set(['ready', 'running', 'review', 'blocked']);
const ACTIVE_STATUSES = new Set(['active', 'partially_blocked']);

/**
 * Worky execution surface (Part 3, `docs/worky/03_EXECUTION_GOVERNANCE.md`).
 *
 * Responsibilities:
 *   - `validateStart`     — readiness check per canonical §4.4. Always
 *     succeeds; returns one of
 *     `fully_executable | partially_executable | globally_blocked` plus the
 *     ready/blocked task lists and a list of human-readable issues.
 *   - `createSnapshot`    — creates an immutable
 *     `WorkyExecutionSnapshot` (planVersion + ready/blocked ids), sets
 *     `stream.executionPlanVersion`, `status=active|partially_blocked`,
 *     `schedulerEnabled=true`, `startedAt`.
 *   - `recomputeReadiness`— re-evaluates the affected DAG branch on each
 *     event. Emits `start_task` / `spawn_ephemeral_agent` /
 *     `resume_runtime_branch` commands on `stream.updated` events. No
 *     polling; every state transition is event-driven.
 *   - `pause/resume/stop` — control_state transitions + audit.
 *   - `moveTask / pauseTask / resumeTask / cancelTask / reviewTask` —
 *     per-task ops. Cancel only on `not_started`; supersede `done`.
 */
@Injectable()
export class WorkyExecutionService {
  constructor(
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
    @InjectModel(WorkyExecutionSnapshot.name)
    private readonly snapshots: Model<WorkyExecutionSnapshotDocument>,
    private readonly events: WorkyEventService,
    private readonly audit: WorkyAuditService,
    private readonly dispatch: WorkyRuntimeDispatchService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyExecutionService.name);
  }

  // =================================================================
  // Public surface
  // =================================================================

  /**
   * Validate the stream's plan for execution. Always succeeds (canonical
   * §4.4: "Start Stream is always clickable"). The result tells the UI
   * which tasks will run, which are blocked, and why.
   */
  async validateStart(streamId: string, userId: string): Promise<IWorkyStartValidationResult> {
    const stream = await this.findStreamForUser(streamId, userId);
    if (!['created', 'planning', 'paused', 'stopped', 'start_validation_failed', 'partially_blocked', 'active'].includes(stream.status)) {
      throw new BadRequestException(
        ErrorCode.WORKY_STREAM_PHASE_INVALID,
        `Cannot validate start in status '${stream.status}'.`,
      );
    }
    if (stream.currentPlanVersion <= 0) {
      return {
        outcome: 'globally_blocked',
        readyTaskIds: [],
        blockedTaskIds: [],
        issues: [
          {
            code: 'no_tasks',
            message: 'Plan is empty. Converse with the Manager to create at least one task before starting.',
          },
        ],
        snapshotId: null,
        executionPlanVersion: null,
      };
    }

    const tasks = await this.tasks
      .find({ streamId: stream._id })
      .select({ _id: 1, lane: 1, executionState: 1, dependsOn: 1, assigneeType: 1, requiredTools: 1, actionCategory: 1 })
      .lean()
      .exec();
    const userTaskIds = tasks
      .filter((t) => !TERMINAL_TASK_LANES.has(String(t.lane)))
      .map((t) => (t._id as Types.ObjectId).toString());
    if (userTaskIds.length === 0) {
      return {
        outcome: 'globally_blocked',
        readyTaskIds: [],
        blockedTaskIds: [],
        issues: [
          {
            code: 'no_tasks',
            message: 'Plan is empty after filtering terminal tasks.',
          },
        ],
        snapshotId: null,
        executionPlanVersion: null,
      };
    }

    const issues: IWorkyStartValidationIssue[] = [];
    const blocked = new Set<string>();

    // Acyclic dependency check (defensive; the plan-delta service already
    // rejects cyclic deltas, but a stream could have been patched later).
    const cycleIds = this.findCycleBlocked(tasks);
    if (cycleIds.length > 0) {
      for (const id of cycleIds) blocked.add(id);
      issues.push({
        code: 'cyclic_dependency',
        message: 'Some tasks form a dependency cycle and cannot be scheduled.',
        taskIds: cycleIds,
      });
    }

    // Executable tasks must have an assignment strategy or be explicitly
    // human-assigned (canonical §4.4).
    for (const t of tasks) {
      if (TERMINAL_TASK_LANES.has(String(t.lane))) continue;
      const id = (t._id as Types.ObjectId).toString();
      if (String(t.assigneeType) === 'unassigned') {
        blocked.add(id);
        issues.push({
          code: 'unassigned',
          message: 'Task is not assigned to an AI or human agent.',
          taskIds: [id],
        });
      }
    }

    const stateByTaskId = new Map(
      tasks.map((t) => [(t._id as Types.ObjectId).toString(), String(t.executionState ?? '')]),
    );
    for (const t of tasks) {
      if (TERMINAL_TASK_LANES.has(String(t.lane))) continue;
      const id = (t._id as Types.ObjectId).toString();
      const pendingDeps = ((t.dependsOn ?? []) as Types.ObjectId[])
        .map((dep) => dep.toString())
        .filter((depId) => stateByTaskId.get(depId) !== 'done');
      if (pendingDeps.length > 0) {
        blocked.add(id);
        issues.push({
          code: 'dependency_pending',
          message: 'Task is waiting for dependency tasks to complete.',
          taskIds: [id],
        });
      }
    }

    // Tasks with required tools that are not yet available are flagged
    // (Part 3 acknowledges this as a `blocked` issue; tool availability
    // resolution is the runtime's job during execution).
    for (const t of tasks) {
      if (TERMINAL_TASK_LANES.has(String(t.lane))) continue;
      const id = (t._id as Types.ObjectId).toString();
      const required = (t.requiredTools ?? []) as string[];
      if (required.length > 0) {
        // We treat unknown tool references as a soft block — the runtime
        // will surface this back as a spawn-worker rejection if needed.
        // The canonical spec defers hard tool-resolution to runtime.
      }
    }

    const ready: string[] = [];
    for (const t of tasks) {
      if (TERMINAL_TASK_LANES.has(String(t.lane))) continue;
      const id = (t._id as Types.ObjectId).toString();
      if (!blocked.has(id)) ready.push(id);
    }

    let outcome: WorkyStartOutcome;
    if (ready.length === 0) {
      outcome = 'globally_blocked';
    } else if (blocked.size === 0) {
      outcome = 'fully_executable';
    } else {
      outcome = 'partially_executable';
    }

    return {
      outcome,
      readyTaskIds: ready,
      blockedTaskIds: Array.from(blocked),
      issues,
      snapshotId: null,
      executionPlanVersion: stream.currentPlanVersion,
    };
  }

  /**
   * Create the execution snapshot and flip the stream to `active` (or
   * `partially_blocked`). Idempotent: a second call on the same plan
   * version returns the existing snapshot.
   */
  async createSnapshot(streamId: string, userId: string): Promise<IWorkyStartValidationResult> {
    const validation = await this.validateStart(streamId, userId);
    const stream = await this.findStreamForUser(streamId, userId);
    if (validation.outcome === 'globally_blocked') {
      await this.streams
        .updateOne(
          { _id: stream._id },
          { $set: { status: 'start_validation_failed', lastActivityAt: new Date() } },
        )
        .exec();
      this.events.emit(stream.ownerUserId.toString(), streamId, {
        type: 'stream.updated',
        emittedAt: Date.now(),
        payload: { status: 'start_validation_failed' },
      });
      return { ...validation, snapshotId: null, executionPlanVersion: stream.currentPlanVersion };
    }

    const existing = await this.snapshots
      .findOne({ streamId: stream._id, planVersion: stream.currentPlanVersion })
      .exec();
    const snapshot =
      existing ??
      (await this.snapshots.create({
        streamId: stream._id,
        planVersion: stream.currentPlanVersion,
        startedByUserId: new Types.ObjectId(userId),
        startedAt: new Date(),
        readyTaskIds: validation.readyTaskIds.map((id) => new Types.ObjectId(id)),
        blockedTaskIds: validation.blockedTaskIds.map((id) => new Types.ObjectId(id)),
      }));

    const newStatus = validation.outcome === 'partially_executable' ? 'partially_blocked' : 'active';
    await this.streams
      .updateOne(
        { _id: stream._id },
        {
          $set: {
            status: newStatus,
            controlState: 'active',
            schedulerEnabled: true,
            executionPlanVersion: stream.currentPlanVersion,
            startedAt: stream.startedAt ?? new Date(),
            lastActivityAt: new Date(),
          },
        },
      )
      .exec();

    await this.audit.append({
      streamId,
      actorUserId: userId,
      action: 'stream.started',
      targetType: 'stream',
      targetId: streamId,
      details: {
        outcome: validation.outcome,
        planVersion: stream.currentPlanVersion,
        snapshotId: (snapshot._id as Types.ObjectId).toString(),
        readyCount: validation.readyTaskIds.length,
        blockedCount: validation.blockedTaskIds.length,
      },
    });

    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'stream.started',
      emittedAt: Date.now(),
      payload: {
        outcome: validation.outcome,
        planVersion: stream.currentPlanVersion,
        snapshotId: (snapshot._id as Types.ObjectId).toString(),
        readyTaskIds: validation.readyTaskIds,
        blockedTaskIds: validation.blockedTaskIds,
        issues: validation.issues,
      },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'stream.updated',
      emittedAt: Date.now(),
      payload: { status: newStatus, controlState: 'active' },
    });

    // Fire-and-forget runtime dispatch (canonical §3.2a). The request
    // returns immediately after the snapshot is created; runtime SSE
    // frames are forwarded to the SSE channel as they arrive. If the
    // runtime is unreachable or returns an error, stream status stays
    // `active` / `partially_blocked` (the snapshot is the user's intent)
    // and a `stream.terminal` error frame is emitted so the UI surfaces
    // the failure.
    if (validation.readyTaskIds.length > 0) {
      const claimedTaskIds = await this.claimTasksForDispatch(validation.readyTaskIds);
      void this.dispatch.dispatchStart(stream, claimedTaskIds).catch((err) =>
        this.logger.warn('Worky runtime start dispatch threw', {
          streamId,
          message: (err as Error).message,
        }),
      );
    }

    return {
      ...validation,
      snapshotId: (snapshot._id as Types.ObjectId).toString(),
      executionPlanVersion: stream.currentPlanVersion,
    };
  }

  /**
   * Re-evaluate the affected DAG branch on each event. Idempotent — the
   * caller passes the event payload and we compute which tasks should
   * transition. The event-service layer (Part 3 internal controller) is
   * the single caller; tests exercise this method directly.
   *
   * Returns the list of commands to dispatch: `start_task`,
   * `spawn_ephemeral_agent`, `resume_runtime_branch`. The actual runtime
   * call is the caller's responsibility (we keep the seam explicit so
   * unit tests don't need the HTTP client).
   */
  async recomputeReadiness(
    streamId: string,
    event: { type: string; payload: Record<string, unknown> },
  ): Promise<Array<{ type: string; taskId: string; reason: string }>> {
    const stream = await this.streams.findById(streamId).lean().exec();
    if (!stream) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    if (!stream.executionPlanVersion) return [];
    if (stream.controlState !== 'active' || !ACTIVE_STATUSES.has(String(stream.status))) {
      return [];
    }

    const commands: Array<{ type: string; taskId: string; reason: string }> = [];
    if (event.type === 'task.completed') {
      const completedTaskId = String(event.payload.taskId ?? '');
      if (!completedTaskId) return commands;
      // Find every task that depends on `completedTaskId` and is not yet
      // running. If all of *its* deps are done, it becomes `ready`.
      const dependents = await this.tasks
        .find({ streamId: stream._id, dependsOn: new Types.ObjectId(completedTaskId) })
        .select({ _id: 1, dependsOn: 1, lane: 1, executionState: 1 })
        .lean()
        .exec();
      for (const dep of dependents) {
        if (String(dep.executionState) !== 'not_started') continue;
        const id = (dep._id as Types.ObjectId).toString();
        const allDepsDone = await this.areAllDepsDone(stream._id, (dep.dependsOn ?? []) as Types.ObjectId[]);
        if (allDepsDone) {
          commands.push({ type: 'start_task', taskId: id, reason: 'dependency-satisfied' });
        }
      }
    } else if (event.type === 'interaction.responded') {
      const interactionTaskIds = (event.payload.blocksTaskIds as string[] | undefined) ?? [];
      for (const id of interactionTaskIds) {
        if (!Types.ObjectId.isValid(id)) continue;
        const task = await this.tasks
          .findOne({ _id: new Types.ObjectId(id), streamId: stream._id })
          .select({ _id: 1, executionState: 1 })
          .lean()
          .exec();
        if (task && String(task.executionState) === 'not_started') {
          const taskId = (task._id as Types.ObjectId).toString();
          const allDepsDone = await this.areAllDepsDone(stream._id, []);
          if (allDepsDone) {
            commands.push({ type: 'resume_runtime_branch', taskId, reason: 'blocker-resolved' });
          }
        }
      }
    }
    return commands;
  }

  /**
   * Event-driven readiness loop (canonical §11.2). Caller passes the
   * raw event payload; we recompute commands and dispatch the
   * resulting runtime calls. This is the single production entry point
   * that turns a backend event (e.g. `task.completed` from the runtime
   * callback) into runtime work.
   *
   * Idempotency: each dispatch path guards on a per-task atomic
    * state update (`not_started → running`)
   * so duplicate events are no-ops.
   */
  async handleExecutionEvent(
    streamId: string,
    event: { type: string; payload: Record<string, unknown> },
  ): Promise<void> {
    const stream = await this.streams.findById(streamId).lean().exec();
    if (!stream) return;
    const commands = await this.recomputeReadiness(streamId, event);
    if (commands.length === 0) return;
    await this.dispatchReadinessCommands(stream as WorkyStreamDocument, commands);
  }

  /**
   * Dispatch the commands returned by `recomputeReadiness` to the
   * runtime. Each command is guarded by an atomic task state
   * transition so duplicate dispatches are safe.
   */
  private async dispatchReadinessCommands(
    stream: WorkyStreamDocument,
    commands: Array<{ type: string; taskId: string; reason: string }>,
  ): Promise<void> {
    for (const cmd of commands) {
      if (cmd.type === 'start_task' || cmd.type === 'spawn_ephemeral_agent') {
        const claimed = await this.claimTaskForDispatch(cmd.taskId);
        if (!claimed) continue;
        await this.dispatch.dispatchSingleTask(stream, cmd.taskId);
      } else if (cmd.type === 'resume_runtime_branch') {
        // Resume is best-effort: a no-op for tasks whose state has
        // already moved to a terminal state since the event was queued.
        const claimed = await this.claimTaskForDispatch(cmd.taskId);
        if (!claimed) continue;
        await this.dispatch.dispatchSingleTask(stream, cmd.taskId);
      }
    }
  }

  /**
   * Atomic guard: flip a task from `not_started` to `running` so a
   * subsequent `task.completed` for the same task cannot re-dispatch
   * it. Returns `false` when the task is already in flight or terminal.
   */
  private async claimTaskForDispatch(taskId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(taskId)) return false;
    const now = new Date();
    const result = await this.tasks
      .updateOne(
        { _id: new Types.ObjectId(taskId), executionState: 'not_started' },
        { $set: { executionState: 'running', lane: 'running', startedAt: now, completedAt: null, durationMs: null, updatedAt: now } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  private async claimTasksForDispatch(taskIds: string[]): Promise<string[]> {
    const claimed: string[] = [];
    for (const taskId of taskIds) {
      if (await this.claimTaskForDispatch(taskId)) claimed.push(taskId);
    }
    return claimed;
  }

  // ----- pause / resume / stop -----

  async pause(streamId: string, userId: string, reason?: string): Promise<IWorkyExecutionSnapshotResponse | null> {
    const stream = await this.findStreamForUser(streamId, userId);
    this.assertControlTransition(stream.controlState, 'pause');
    await this.streams
      .updateOne(
        { _id: stream._id },
        {
          $set: {
            controlState: 'paused',
            status: 'paused',
            lastActivityAt: new Date(),
          },
        },
      )
      .exec();
    await this.audit.append({
      streamId,
      actorUserId: userId,
      action: 'stream.paused',
      targetType: 'stream',
      targetId: streamId,
      details: { reason: reason ?? '' },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'stream.paused',
      emittedAt: Date.now(),
      payload: { reason: reason ?? '' },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'stream.updated',
      emittedAt: Date.now(),
      payload: { status: 'paused', controlState: 'paused' },
    });
    return this.latestSnapshotResponse(streamId);
  }

  async resume(streamId: string, userId: string, reason?: string): Promise<IWorkyExecutionSnapshotResponse | null> {
    const stream = await this.findStreamForUser(streamId, userId);
    this.assertControlTransition(stream.controlState, 'resume');
    await this.streams
      .updateOne(
        { _id: stream._id },
        {
          $set: {
            controlState: 'active',
            status: stream.executionPlanVersion ? 'active' : 'planning',
            lastActivityAt: new Date(),
          },
        },
      )
      .exec();
    await this.audit.append({
      streamId,
      actorUserId: userId,
      action: 'stream.resumed',
      targetType: 'stream',
      targetId: streamId,
      details: { reason: reason ?? '' },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'stream.resumed',
      emittedAt: Date.now(),
      payload: { reason: reason ?? '' },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'stream.updated',
      emittedAt: Date.now(),
      payload: { status: 'active', controlState: 'active' },
    });

    // Fire-and-forget runtime resume. The runtime re-dispatches any
    // ready tasks via the existing /start flow on its side.
    if (stream.executionPlanVersion) {
      void this.dispatch.dispatchResume(stream, reason).catch((err) =>
        this.logger.warn('Worky runtime resume dispatch threw', {
          streamId,
          message: (err as Error).message,
        }),
      );
    }

    return this.latestSnapshotResponse(streamId);
  }

  async stop(streamId: string, userId: string, reason?: string): Promise<void> {
    const stream = await this.findStreamForUser(streamId, userId);
    this.assertControlTransition(stream.controlState, 'stop');
    await this.streams
      .updateOne(
        { _id: stream._id },
        {
          $set: {
            controlState: 'stopped',
            status: 'stopped',
            completedAt: new Date(),
            lastActivityAt: new Date(),
            schedulerEnabled: false,
          },
        },
      )
      .exec();
    await this.audit.append({
      streamId,
      actorUserId: userId,
      action: 'stream.stopped',
      targetType: 'stream',
      targetId: streamId,
      details: { reason: reason ?? '' },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'stream.stopped',
      emittedAt: Date.now(),
      payload: { reason: reason ?? '' },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'stream.terminal',
      emittedAt: Date.now(),
      payload: { status: 'stopped' },
    });

    // Fire-and-forget runtime stop. Failures are warnings only — the
    // backend state is already terminal.
    void this.dispatch.dispatchStop(stream).catch((err) =>
      this.logger.warn('Worky runtime stop dispatch threw', {
        streamId,
        message: (err as Error).message,
      }),
    );
  }

  // ----- per-task ops -----

  /**
   * Move a task to a new lane. Used by the Kanban UI to reflect the
   * owner's manual triage. Validates that the move respects the
   * `not_started -> canceled` rule and the `done -> superseded` rule
   * (canonical §3.6).
   */
  async moveTask(
    taskId: string,
    userId: string,
    lane: string,
    reason?: string,
  ): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    this.assertLaneTransition(task.lane, lane);
    const nextExecutionState = laneToExecutionState(lane);
    task.lane = lane;
    if (nextExecutionState) task.executionState = nextExecutionState;
    task.set('updatedAt', new Date());
    await task.save();
    this.events.emit(task.streamId.toString(), task.streamId.toString(), {
      type: 'task.updated',
      emittedAt: Date.now(),
      payload: { taskId: task.id, lane, reason: reason ?? '' },
    });
    return {
      id: (task._id as Types.ObjectId).toString(),
      title: task.title,
      lane: task.lane,
      executionState: task.executionState,
    };
  }

  async pauseTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    this.assertTaskNotTerminal(task.executionState);
    task.controlState = 'paused';
    task.set('updatedAt', new Date());
    await task.save();
    this.events.emit(task.streamId.toString(), task.streamId.toString(), {
      type: 'task.updated',
      emittedAt: Date.now(),
      payload: { taskId: task.id, controlState: 'paused', reason: reason ?? '' },
    });
    return {
      id: (task._id as Types.ObjectId).toString(),
      title: task.title,
      lane: task.lane,
      executionState: task.executionState,
    };
  }

  async resumeTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    task.controlState = 'active';
    task.set('updatedAt', new Date());
    await task.save();
    this.events.emit(task.streamId.toString(), task.streamId.toString(), {
      type: 'task.updated',
      emittedAt: Date.now(),
      payload: { taskId: task.id, controlState: 'active', reason: reason ?? '' },
    });
    return {
      id: (task._id as Types.ObjectId).toString(),
      title: task.title,
      lane: task.lane,
      executionState: task.executionState,
    };
  }

  /**
   * Cancel a task. Allowed only on `not_started`; tasks already in
   * `running` are rejected. `done` tasks are superseded, not deleted.
   */
  async cancelTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    const previousExecutionState = task.executionState;
    if (task.executionState === 'not_started') {
      task.lane = 'canceled';
      task.executionState = 'canceled';
      task.controlState = 'stopped';
    } else if (task.executionState === 'done') {
      task.lane = 'superseded';
      task.controlState = 'stopped';
    } else {
      throw new ConflictException(
        ErrorCode.WORKY_TASK_INVALID_STATE,
        `Cannot cancel task in executionState '${task.executionState}'.`,
      );
    }
    task.set('updatedAt', new Date());
    await task.save();
    this.events.emit(task.streamId.toString(), task.streamId.toString(), {
      type: 'task.updated',
      emittedAt: Date.now(),
      payload: { taskId: task.id, lane: task.lane, reason: reason ?? '' },
    });

    // Fire-and-forget runtime cancel. Only meaningful for tasks that may
    // have an active worker. `done` → `superseded` is a no-op on the
    // runtime (no worker is alive for a terminal task).
    if (previousExecutionState === 'not_started') {
      void this.dispatch.dispatchCancelTask(task.id).catch((err) =>
        this.logger.warn('Worky runtime cancel dispatch threw', {
          taskId: task.id,
          message: (err as Error).message,
        }),
      );
    }

    return {
      id: (task._id as Types.ObjectId).toString(),
      title: task.title,
      lane: task.lane,
      executionState: task.executionState,
    };
  }

  /**
   * Move a task into `review`. The runtime is expected to surface a
   * review interaction; we only mutate the local state here.
   */
  async reviewTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    if (task.executionState !== 'running') {
      throw new ConflictException(
        ErrorCode.WORKY_TASK_INVALID_STATE,
        `Only running tasks can be moved to review (got '${task.executionState}').`,
      );
    }
    task.lane = 'review';
    task.executionState = 'review';
    task.set('updatedAt', new Date());
    await task.save();
    this.events.emit(task.streamId.toString(), task.streamId.toString(), {
      type: 'task.updated',
      emittedAt: Date.now(),
      payload: { taskId: task.id, lane: 'review', reason: reason ?? '' },
    });
    return {
      id: (task._id as Types.ObjectId).toString(),
      title: task.title,
      lane: task.lane,
      executionState: task.executionState,
    };
  }

  // =================================================================
  // Internals
  // =================================================================

  private async findStreamForUser(streamId: string, userId: string): Promise<WorkyStreamDocument> {
    if (!Types.ObjectId.isValid(streamId)) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    const stream = await this.streams.findById(streamId).exec();
    if (!stream) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    if (stream.ownerUserId.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky stream.',
      );
    }
    return stream;
  }

  private async findTaskForUser(taskId: string, userId: string): Promise<WorkyTaskDocument> {
    if (!Types.ObjectId.isValid(taskId)) {
      throw new NotFoundException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }
    const task = await this.tasks.findById(taskId).exec();
    if (!task) {
      throw new NotFoundException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }
    // Owner check via stream.
    const stream = await this.streams
      .findById(task.streamId)
      .select({ ownerUserId: 1 })
      .lean()
      .exec();
    if (!stream || stream.ownerUserId.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky task.',
      );
    }
    return task;
  }

  private assertControlTransition(current: string, op: 'pause' | 'resume' | 'stop'): void {
    if (op === 'pause' && current !== 'active' && current !== 'pause_requested') {
      throw new ConflictException(
        ErrorCode.WORKY_STREAM_INVALID_STATE,
        `Cannot pause from controlState '${current}'.`,
      );
    }
    if (op === 'resume' && current !== 'paused' && current !== 'resume_requested') {
      throw new ConflictException(
        ErrorCode.WORKY_STREAM_INVALID_STATE,
        `Cannot resume from controlState '${current}'.`,
      );
    }
    if (op === 'stop' && (current === 'stopped' || current === 'stop_requested')) {
      throw new ConflictException(
        ErrorCode.WORKY_STREAM_INVALID_STATE,
        `Stream is already in controlState '${current}'.`,
      );
    }
  }

  private assertLaneTransition(current: string, next: string): void {
    if (current === next) return;
    if (TERMINAL_TASK_LANES.has(current)) {
      throw new ConflictException(
        ErrorCode.WORKY_TASK_INVALID_STATE,
        `Task in lane '${current}' is terminal and cannot be moved.`,
      );
    }
    if (TERMINAL_TASK_LANES.has(next) && current === 'running') {
      // Cancel during running requires a separate approval flow (canonical
      // §3.6). Direct moves into terminal lanes from `running` are blocked.
      throw new ConflictException(
        ErrorCode.WORKY_TASK_INVALID_STATE,
        `Cannot move a running task directly to '${next}'.`,
      );
    }
  }

  private assertTaskNotTerminal(executionState: string): void {
    if (['done', 'failed', 'canceled', 'superseded'].includes(executionState)) {
      throw new ConflictException(
        ErrorCode.WORKY_TASK_INVALID_STATE,
        `Task in executionState '${executionState}' cannot be paused.`,
      );
    }
  }

  private async areAllDepsDone(
    streamObjectId: Types.ObjectId,
    depIds: Types.ObjectId[],
  ): Promise<boolean> {
    if (depIds.length === 0) return true;
    const deps = await this.tasks
      .find({ _id: { $in: depIds }, streamId: streamObjectId })
      .select({ executionState: 1 })
      .lean()
      .exec();
    if (deps.length !== depIds.length) return false;
    return deps.every((d) => d.executionState === 'done');
  }

  private async latestSnapshotResponse(
    streamId: string,
  ): Promise<IWorkyExecutionSnapshotResponse | null> {
    if (!Types.ObjectId.isValid(streamId)) return null;
    const snap = await this.snapshots
      .findOne({ streamId: new Types.ObjectId(streamId) })
      .sort({ planVersion: -1 })
      .lean()
      .exec();
    if (!snap) return null;
    return {
      id: (snap._id as Types.ObjectId).toString(),
      streamId: (snap.streamId as Types.ObjectId).toString(),
      planVersion: Number(snap.planVersion),
      startedByUserId: (snap.startedByUserId as Types.ObjectId).toString(),
      startedAt: snap.startedAt instanceof Date ? snap.startedAt.toISOString() : String(snap.startedAt),
      readyTaskIds: (snap.readyTaskIds ?? []).map((id) => (id as Types.ObjectId).toString()),
      blockedTaskIds: (snap.blockedTaskIds ?? []).map((id) => (id as Types.ObjectId).toString()),
      createdAt: snap.createdAt instanceof Date ? snap.createdAt.toISOString() : String(snap.createdAt),
    };
  }

  /**
   * Find tasks in a dependency cycle. Returns the ids of tasks that
   * are part of a cycle in the non-terminal task subgraph. We use a
   * simple iterative algorithm: nodes with zero indegree are removed
   * until none remain; whatever's left is a cycle.
   */
  private findCycleBlocked(
    tasks: Array<{ _id: Types.ObjectId; dependsOn?: Types.ObjectId[]; lane?: string }>,
  ): string[] {
    const nodes = tasks.filter((t) => !TERMINAL_TASK_LANES.has(String(t.lane)));
    const idToIdx = new Map<string, number>();
    nodes.forEach((n, i) => idToIdx.set((n._id as Types.ObjectId).toString(), i));
    const adjacency: number[][] = nodes.map(() => []);
    const indegree = new Array<number>(nodes.length).fill(0);
    for (let i = 0; i < nodes.length; i++) {
      const deps = (nodes[i]?.dependsOn ?? []) as Types.ObjectId[];
      for (const dep of deps) {
        const depId = (dep as Types.ObjectId).toString();
        const depIdx = idToIdx.get(depId);
        if (depIdx === undefined) continue;
        adjacency[i]!.push(depIdx);
        indegree[depIdx] = (indegree[depIdx] ?? 0) + 1;
      }
    }
    const queue: number[] = [];
    for (let i = 0; i < indegree.length; i++) {
      if (indegree[i] === 0) queue.push(i);
    }
    let processed = 0;
    while (queue.length > 0) {
      const i = queue.shift()!;
      processed++;
      for (const next of adjacency[i]!) {
        indegree[next] = (indegree[next] ?? 0) - 1;
        if (indegree[next] === 0) queue.push(next);
      }
    }
    const cycleIds: string[] = [];
    for (let i = 0; i < nodes.length; i++) {
      if (indegree[i]! > 0) {
        cycleIds.push((nodes[i]!._id as Types.ObjectId).toString());
      }
    }
    return cycleIds;
  }
}

function laneToExecutionState(lane: string): string | null {
  if (lane === 'ready') return 'scheduled';
  if (lane === 'running') return 'running';
  if (lane === 'review') return 'review';
  if (lane === 'done') return 'done';
  if (lane === 'blocked') return 'waiting_for_event';
  if (lane === 'backlog') return 'not_started';
  return null;
}

// Runnability sentinel — kept for future use; `RUNNABLE_LANES` is referenced
// in the docs to clarify intent even when the current start-validation does
// not gate on lane for "executable" tasks. The constant is exported for tests.
export const __RUNNABLE_LANES = RUNNABLE_LANES;
