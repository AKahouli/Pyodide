import { FlowExecution } from '../schemas/playbook-flow-execution.schema';
import { IFlowExecutionResponse } from '../interfaces/playbook-flow-execution.interface';

export function executionToResponse(execution: FlowExecution): IFlowExecutionResponse {
  const doc = execution as unknown as { _id?: string; toJSON?: () => Record<string, unknown> };
  return {
    id: (doc._id as string) || '',
    flowId: execution.flowId,
    ownerId: execution.ownerId,
    schemaVersion: execution.schemaVersion,
    status: execution.status,
    startedAt: execution.startedAt,
    endedAt: execution.endedAt,
    error: execution.error,
    recursionLimit: execution.recursionLimit,
    maxParallelism: execution.maxParallelism,
    inputContext: execution.inputContext,
    idempotencyKey: execution.idempotencyKey,
    pendingApproval: execution.pendingApproval ?? null,
    queuePosition: execution.queuePosition,
    threadId: execution.threadId,
    replaySource: (execution as any).replaySource ?? undefined,
    createdAt: (execution as any).createdAt || new Date(),
    updatedAt: (execution as any).updatedAt || new Date(),
  };
}
