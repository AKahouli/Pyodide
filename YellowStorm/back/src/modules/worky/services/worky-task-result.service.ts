import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyTaskResult,
  WorkyTaskResultDocument,
} from '../schemas/worky-task-result.schema';
import {
  WorkyTask,
  WorkyTaskDocument,
} from '../schemas/worky-task.schema';
import { LoggerService } from '../../logger';

export interface RecordTaskResultInput {
  taskId: string;
  status: string;
  summary?: string;
  contentArtifactId?: string | null;
  createdByWorkerId?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface RecordTaskResultResult {
  taskResultId: string;
  taskId: string;
  version: number;
  status: string;
  replay: boolean;
  taskTransitionedTo: 'done' | 'failed' | 'no_change';
}

export interface WorkyTaskResultView {
  id: string;
  taskId: string;
  version: number;
  status: string;
  summary: string;
  payload: Record<string, unknown> | null;
  contentArtifactId: string | null;
  createdByWorkerId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Terminal status values produced by the runtime that we mirror to the
 * task lane/executionState. Anything else is treated as a non-terminal
 * update and leaves the task state alone.
 */
const TERMINAL_LANE_BY_STATUS: Record<string, { lane: string; executionState: string }> = {
  done: { lane: 'done', executionState: 'done' },
  failed: { lane: 'done', executionState: 'failed' },
};

const SUMMARY_MAX_LENGTH = 5000;

@Injectable()
export class WorkyTaskResultService {
  constructor(
    @InjectModel(WorkyTaskResult.name)
    private readonly results: Model<WorkyTaskResultDocument>,
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyTaskResultService.name);
  }

  async record(input: RecordTaskResultInput): Promise<RecordTaskResultResult> {
    if (!Types.ObjectId.isValid(input.taskId)) {
      throw new Error('WorkyTaskResultService.record: invalid taskId');
    }
    const latest = await this.results
      .findOne({ taskId: new Types.ObjectId(input.taskId) })
      .sort({ version: -1 })
      .select({ version: 1 })
      .lean()
      .exec();
    const nextVersion = (latest?.version ?? 0) + 1;
    const summary = input.summary ?? '';
    const payload = input.payload ? { ...input.payload } : {};
    if (summary.length > SUMMARY_MAX_LENGTH && typeof payload.output !== 'string') {
      payload.output = summary;
    }
    const created = await this.results.create({
      taskId: new Types.ObjectId(input.taskId),
      version: nextVersion,
      status: input.status,
      summary: truncateSummary(summary),
      payload: Object.keys(payload).length > 0 ? payload : null,
      contentArtifactId:
        input.contentArtifactId && Types.ObjectId.isValid(input.contentArtifactId)
          ? new Types.ObjectId(input.contentArtifactId)
          : null,
      createdByWorkerId:
        input.createdByWorkerId && Types.ObjectId.isValid(input.createdByWorkerId)
          ? new Types.ObjectId(input.createdByWorkerId)
          : null,
    });

    const transition = await this.mirrorTaskState(input.taskId, input.status);

    this.logger.log('Worky task result recorded', {
      taskId: input.taskId,
      version: nextVersion,
      status: input.status,
      taskTransitionedTo: transition,
    });
    return {
      taskResultId: (created._id as Types.ObjectId).toString(),
      taskId: input.taskId,
      version: nextVersion,
      status: input.status,
      replay: false,
      taskTransitionedTo: transition,
    };
  }

  async listForTask(taskId: string): Promise<WorkyTaskResultView[]> {
    if (!Types.ObjectId.isValid(taskId)) return [];
    const rows = await this.results
      .find({ taskId: new Types.ObjectId(taskId) })
      .sort({ version: -1 })
      .lean()
      .exec();
    return rows.map((row) => ({
      id: (row._id as Types.ObjectId).toString(),
      taskId,
      version: row.version,
      status: row.status,
      summary: row.summary ?? '',
      payload: (row.payload as Record<string, unknown> | null | undefined) ?? null,
      contentArtifactId: row.contentArtifactId ? (row.contentArtifactId as Types.ObjectId).toString() : null,
      createdByWorkerId: row.createdByWorkerId ? (row.createdByWorkerId as Types.ObjectId).toString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    }));
  }

  /**
   * Mirror a terminal runtime result onto the task's lane and
   * executionState. The runtime is the source of truth for terminal
   * outcomes; the backend only needs to keep the task row consistent so
   * readiness evaluation sees `done`/`failed` (canonical §3.2). Non-
   * terminal statuses are a no-op to avoid racing a future retry.
   */
  private async mirrorTaskState(
    taskId: string,
    status: string,
  ): Promise<'done' | 'failed' | 'no_change'> {
    const transition = TERMINAL_LANE_BY_STATUS[status];
    if (!transition) return 'no_change';
    const completedAt = new Date();
    const task = await this.tasks
      .findOne({ _id: new Types.ObjectId(taskId), executionState: { $nin: ['done', 'failed', 'canceled', 'superseded'] } })
      .select({ startedAt: 1 })
      .lean()
      .exec();
    if (!task) return 'no_change';
    const startedAt = task.startedAt ? new Date(task.startedAt) : null;
    const durationMs = startedAt ? Math.max(0, completedAt.getTime() - startedAt.getTime()) : null;
    const result = await this.tasks
      .updateOne(
        { _id: new Types.ObjectId(taskId), executionState: { $nin: ['done', 'failed', 'canceled', 'superseded'] } },
        { $set: { lane: transition.lane, executionState: transition.executionState, completedAt, durationMs, updatedAt: completedAt } },
      )
      .exec();
    if (result.matchedCount === 0) return 'no_change';
    return transition.executionState === 'failed' ? 'failed' : 'done';
  }
}

function truncateSummary(summary: string): string {
  if (summary.length <= SUMMARY_MAX_LENGTH) return summary;
  return `${summary.slice(0, SUMMARY_MAX_LENGTH - 15).trimEnd()}\n[truncated]`;
}
