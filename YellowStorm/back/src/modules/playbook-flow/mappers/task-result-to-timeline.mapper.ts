import { FlowTaskResult } from '../schemas/playbook-flow-task-result.schema';
import { IFlowTaskResultResponse } from '../interfaces/playbook-flow-execution.interface';

export function taskResultsToTimeline(results: FlowTaskResult[]): IFlowTaskResultResponse[] {
  return results.map((r) => {
    const doc = r as unknown as { _id?: string };
    return {
      id: (doc._id as string) || '',
      executionId: r.executionId,
      taskId: r.taskId,
      iteration: r.iteration,
      status: r.status,
      output: r.output,
      error: r.error,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    };
  });
}
