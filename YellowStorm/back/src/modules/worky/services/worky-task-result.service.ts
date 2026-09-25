import { Injectable } from '@nestjs/common';
import { isForeignKeyViolation, isObjectId } from '@common/postgres';
import { WorkyTaskResultRepository } from '../persistence/worky-task-result.repository';
import { WorkyTaskRepository } from '../persistence/worky-task.repository';
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
    private readonly results: WorkyTaskResultRepository,
    private readonly tasks: WorkyTaskRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyTaskResultService.name);
  }

  async record(input: RecordTaskResultInput): Promise<RecordTaskResultResult> {
    if (!isObjectId(input.taskId)) {
      throw new Error('WorkyTaskResultService.record: invalid taskId');
    }
    const summary = input.summary ?? '';
    const payload = input.payload ? { ...input.payload } : {};
    if (summary.length > SUMMARY_MAX_LENGTH && typeof payload.output !== 'string') {
      payload.output = summary;
    }
    const createdByWorkerId =
      input.createdByWorkerId && isObjectId(input.createdByWorkerId) ? input.createdByWorkerId : null;
    // The repository numbers the version and settles a concurrent writer.
    const created = await this.results
      .append({
        taskId: input.taskId,
        status: input.status,
        summary: truncateSummary(summary),
        payload: Object.keys(payload).length > 0 ? payload : null,
        contentArtifactId:
          input.contentArtifactId && isObjectId(input.contentArtifactId) ? input.contentArtifactId : null,
        createdByWorkerId,
      })
      .catch((err: unknown) => {
        // task_results.task_id and created_by_worker_id are foreign keys.
        if (isForeignKeyViolation(err)) {
          const worker = createdByWorkerId ? ` or worker ${createdByWorkerId}` : '';
          throw new Error(`WorkyTaskResultService.record: task ${input.taskId}${worker} not found`);
        }
        throw err;
      });

    const transition = await this.mirrorTaskState(input.taskId, input.status);

    this.logger.log('Worky task result recorded', {
      taskId: input.taskId,
      version: created.version,
      status: input.status,
      taskTransitionedTo: transition,
    });
    return {
      taskResultId: created.id,
      taskId: input.taskId,
      version: created.version,
      status: input.status,
      replay: false,
      taskTransitionedTo: transition,
    };
  }

  async listForTask(taskId: string): Promise<WorkyTaskResultView[]> {
    if (!isObjectId(taskId)) return [];
    const rows = await this.results.listForTask(taskId);
    return rows.map((row) => ({
      id: row.id,
      taskId,
      version: row.version,
      status: row.status,
      summary: row.summary,
      payload: row.payload ?? null,
      contentArtifactId: row.contentArtifactId,
      createdByWorkerId: row.createdByWorkerId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
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
    // One conditional UPDATE: only a task that is not terminal yet moves, with its duration.
    const moved = await this.tasks.completeIfOpen(taskId, transition, new Date());
    if (!moved) return 'no_change';
    return transition.executionState === 'failed' ? 'failed' : 'done';
  }
}

function truncateSummary(summary: string): string {
  if (summary.length <= SUMMARY_MAX_LENGTH) return summary;
  return `${summary.slice(0, SUMMARY_MAX_LENGTH - 15).trimEnd()}\n[truncated]`;
}
