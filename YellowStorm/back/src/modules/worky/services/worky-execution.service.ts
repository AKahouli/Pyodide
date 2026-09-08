import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkyStream, WorkyStreamDocument } from '../schemas/worky-stream.schema';
import { WorkyTask, WorkyTaskDocument } from '../schemas/worky-task.schema';
import { ConflictException, ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkyEventService } from './worky-event.service';
import { IWorkyTaskSummary } from '../interfaces/worky-execution.interface';

@Injectable()
export class WorkyExecutionService {
  constructor(
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
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
    task.lane = lane;
    if (nextExecutionState) task.executionState = nextExecutionState;
    task.set('updatedAt', new Date());
    await task.save();
    this.emitTaskUpdate(task, { lane, reason: reason ?? '' });
    return this.toSummary(task);
  }

  async pauseTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    this.assertTaskNotTerminal(task.executionState);
    task.controlState = 'paused';
    task.set('updatedAt', new Date());
    await task.save();
    this.emitTaskUpdate(task, { controlState: 'paused', reason: reason ?? '' });
    return this.toSummary(task);
  }

  async resumeTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
    task.controlState = 'active';
    task.set('updatedAt', new Date());
    await task.save();
    this.emitTaskUpdate(task, { controlState: 'active', reason: reason ?? '' });
    return this.toSummary(task);
  }

  async cancelTask(taskId: string, userId: string, reason?: string): Promise<IWorkyTaskSummary> {
    const task = await this.findTaskForUser(taskId, userId);
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
    this.emitTaskUpdate(task, { lane: task.lane, reason: reason ?? '' });
    return this.toSummary(task);
  }

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
    this.emitTaskUpdate(task, { lane: 'review', reason: reason ?? '' });
    return this.toSummary(task);
  }

  private async findTaskForUser(taskId: string, userId: string): Promise<WorkyTaskDocument> {
    if (!Types.ObjectId.isValid(taskId)) {
      throw new NotFoundException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }
    const task = await this.tasks.findById(taskId).exec();
    if (!task) {
      throw new NotFoundException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }
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

  private assertTaskNotTerminal(executionState: string): void {
    if (['done', 'failed', 'canceled', 'superseded'].includes(executionState)) {
      throw new ConflictException(
        ErrorCode.WORKY_TASK_INVALID_STATE,
        `Task in executionState '${executionState}' cannot be paused.`,
      );
    }
  }

  private emitTaskUpdate(
    task: WorkyTaskDocument,
    payload: Record<string, unknown>,
  ): void {
    const streamId = task.streamId.toString();
    this.events.emit(streamId, streamId, {
      type: 'task.updated',
      emittedAt: Date.now(),
      payload: { taskId: task.id, ...payload },
    });
  }

  private toSummary(task: WorkyTaskDocument): IWorkyTaskSummary {
    return {
      id: (task._id as Types.ObjectId).toString(),
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
