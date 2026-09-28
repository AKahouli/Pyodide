import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { WorkyStreamRepository } from '../persistence/worky-stream.repository';
import { WorkyTaskRepository, type WorkyTaskPatch } from '../persistence/worky-task.repository';
import type { WorkyTaskRecord } from '../worky.types';
import { ConflictException, ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkyEventService } from './worky-event.service';
import { IWorkyTaskSummary } from '../interfaces/worky-execution.interface';
import { canWriteWorkyStream } from '../worky-stream-access';

@Injectable()
export class WorkyExecutionService {
  constructor(
    private readonly streams: WorkyStreamRepository,
    private readonly tasks: WorkyTaskRepository,
    private readonly events: WorkyEventService,
  ) {}

  async moveTask(
    taskId: string,
    userId: string,
    lane: string,
    reason?: string,
  ): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    const nextExecutionState = laneToExecutionState(lane);
    const updated = await this.save(task, nextExecutionState ? { lane, executionState: nextExecutionState } : { lane });
    this.emitTaskUpdate(updated, { lane, reason: reason ?? '' });
    return this.toSummary(updated);
  }

  async pauseTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    this.assertTaskNotTerminal(task.executionState);
    const updated = await this.save(task, { controlState: 'paused' });
    this.emitTaskUpdate(updated, { controlState: 'paused', reason: reason ?? '' });
    return this.toSummary(updated);
  }

  async resumeTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    const updated = await this.save(task, { controlState: 'active' });
    this.emitTaskUpdate(updated, { controlState: 'active', reason: reason ?? '' });
    return this.toSummary(updated);
  }

  async cancelTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    let patch: WorkyTaskPatch;
    if (task.executionState === 'not_started') {
      patch = { lane: 'canceled', executionState: 'canceled', controlState: 'stopped' };
    } else if (task.executionState === 'done') {
      patch = { lane: 'superseded', controlState: 'stopped' };
    } else {
      throw new ConflictException(
        ErrorCode.WORKY_TASK_INVALID_STATE,
        `Cannot cancel task in executionState '${task.executionState}'.`,
      );
    }
    const updated = await this.save(task, patch);
    this.emitTaskUpdate(updated, { lane: updated.lane, reason: reason ?? '' });
    return this.toSummary(updated);
  }

  async reviewTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    if (task.executionState !== 'running') {
      throw new ConflictException(
        ErrorCode.WORKY_TASK_INVALID_STATE,
        `Only running tasks can be moved to review (got '${task.executionState}').`,
      );
    }
    const updated = await this.save(task, { lane: 'review', executionState: 'review' });
    this.emitTaskUpdate(updated, { lane: 'review', reason: reason ?? '' });
    return this.toSummary(updated);
  }

  private async findTaskForUser(taskId: string, userId: string): Promise<WorkyTaskRecord> {
    if (!isObjectId(taskId)) {
      throw new NotFoundException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }
    const task = await this.tasks.findById(taskId);
    if (!task) {
      throw new NotFoundException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }
    const stream = await this.streams.findById(task.streamId);
    if (!stream || !canWriteWorkyStream(stream, userId)) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky task.',
      );
    }
    return task;
  }

  /** Applies the patch; the task can only have vanished if it was deleted with its stream meanwhile. */
  private async save(task: WorkyTaskRecord, patch: WorkyTaskPatch): Promise<WorkyTaskRecord> {
    const updated = await this.tasks.update(task.id, patch);
    if (!updated) {
      throw new NotFoundException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }
    return updated;
  }

  private assertTaskNotTerminal(executionState: string): void {
    if (['done', 'failed', 'canceled', 'superseded'].includes(executionState)) {
      throw new ConflictException(
        ErrorCode.WORKY_TASK_INVALID_STATE,
        `Task in executionState '${executionState}' cannot be paused.`,
      );
    }
  }

  private emitTaskUpdate(
    task: WorkyTaskRecord,
    payload: Record<string, unknown>,
  ): void {
    this.events.emit(task.streamId, task.streamId, {
      type: 'task.updated',
      emittedAt: Date.now(),
      payload: { taskId: task.id, ...payload },
    });
  }

  private toSummary(task: WorkyTaskRecord): IWorkyTaskSummary {
    return {
      id: task.id,
      title: task.title,
      lane: task.lane,
      executionState: task.executionState,
    };
  }
}

function laneToExecutionState(lane: string): string | null {
  const mapping: Record<string, string> = {
    backlog: 'not_started',
    ready: 'not_started',
    running: 'running',
    review: 'review',
    done: 'done',
    blocked: 'not_started',
    failed: 'failed',
    canceled: 'canceled',
    superseded: 'done',
    archived: 'done',
  };
  return mapping[lane] ?? null;
}
