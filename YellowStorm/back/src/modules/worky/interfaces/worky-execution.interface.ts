/**
 * Wire shapes returned by the Part 3 execution surface
 * (`docs/worky/03_EXECUTION_GOVERNANCE.md`).
 */

export type WorkyStartOutcome = 'fully_executable' | 'partially_executable' | 'globally_blocked';

export interface IWorkyStartValidationIssue {
  code: string;
  message: string;
  taskIds?: string[];
}

export interface IWorkyStartValidationResult {
  outcome: WorkyStartOutcome;
  readyTaskIds: string[];
  blockedTaskIds: string[];
  issues: IWorkyStartValidationIssue[];
  snapshotId: string | null;
  executionPlanVersion: number | null;
}

export interface IWorkyTaskSummary {
  id: string;
  title: string;
  lane: string;
  executionState: string;
}

export interface IWorkyExecutionSnapshotResponse {
  id: string;
  streamId: string;
  planVersion: number;
  startedByUserId: string;
  startedAt: string;
  readyTaskIds: string[];
  blockedTaskIds: string[];
  createdAt: string;
}
