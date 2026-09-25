import { Injectable } from '@nestjs/common';
import {
  TaskResultRepository,
  type TaskResultRecord,
  type TaskResultStatus,
} from '../persistence/task-result.repository';

@Injectable()
export class PlaybookFlowResultsService {
  constructor(
    private readonly taskResultRepository: TaskResultRepository,
  ) {}

  /** Creates or updates the (execution, task, iteration) result. Null when the execution no longer exists. */
  async upsertResult(
    executionId: string,
    taskId: string,
    iteration: number,
    update: { status?: string; output?: unknown; error?: string; startedAt?: Date; endedAt?: Date },
  ): Promise<TaskResultRecord | null> {
    const key = { executionId, taskId, iteration };
    const { status, ...rest } = update;
    const written = await this.taskResultRepository.upsert(key, {
      ...rest,
      ...(status !== undefined ? { status: status as TaskResultStatus } : {}),
    });
    return written ? this.taskResultRepository.find(key) : null;
  }

  async getResults(executionId: string): Promise<TaskResultRecord[]> {
    return this.taskResultRepository.listForExecution(executionId);
  }

  async getResultsForTask(executionId: string, taskId: string): Promise<TaskResultRecord[]> {
    return this.taskResultRepository.listForExecution(executionId, { taskIds: [taskId] });
  }
}
