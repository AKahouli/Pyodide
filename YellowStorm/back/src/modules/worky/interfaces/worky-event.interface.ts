/**
 * In-memory event payload published on `/worky/streams/{id}/events` SSE.
 * The `type` discriminator is what the frontend uses to route frames into
 * the Zustand board store. Durable persistence is via the audit log; this
 * is the live fan-out channel.
 */
export type WorkyEventType =
  | 'stream.updated'
  | 'plan.delta.applied'
  | 'plan.version.created'
  | 'task.updated'
  | 'message.appended'
  | 'assistant_token'
  | 'interaction.requested'
  | 'interaction.responded'
  | 'governance.evaluated'
  | 'budget.updated'
  | 'cost.recorded'
  | 'artifact.persisted'
  | 'worker.spawned'
  | 'task.completed'
  | 'message.component.appended'
  | 'task.component.appended'
  | 'task.artifact.appended'
  | 'stream.started'
  | 'stream.paused'
  | 'stream.resumed'
  | 'stream.stopped'
  | 'stream.terminal'
  | 'human_task.assigned'
  | 'human_task.feedback_submitted'
  | 'human_task.reminder'
  | 'human_task.deadline'
  | 'human_task.completed'
  | 'budget.reserved'
  | 'budget.exhausted'
  | 'budget_decision.requested'
  | 'report.generated'
  | 'memory.proposed'
  | 'memory.confirmed'
  | 'memory.rejected'
  | 'replan.required'
  | 'replan.applied'
  | 'replan.approval_required'
  | 'heartbeat';

export interface WorkyEvent {
  type: WorkyEventType;
  streamId: string;
  emittedAt: number;
  payload: Record<string, unknown>;
}
