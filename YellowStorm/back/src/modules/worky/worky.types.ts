import type * as schema from '@modules/postgres/schema';

/**
 * Record types of the worky repositories (roadmap P7). Ids are 24-char hex strings and every
 * reference is a string, so services never touch an ObjectId. Streams and tasks keep the nested
 * `budget` shape their Mongo documents had; the other tables are the plain row.
 */

export type WorkyBudgetEnforcement = 'hard_stop' | 'notify';
export type WorkySharePermission = 'read' | 'write';

export interface WorkyStreamBudget {
  limitUsd: number;
  limitTokens: number;
  spendUsd: number;
  tokensUsed: number;
  enforcement: WorkyBudgetEnforcement;
}

export type WorkyStreamShareRecord = Omit<typeof schema.workyStreamShares.$inferSelect, 'permission'> & {
  permission: WorkySharePermission;
};

export interface WorkyStreamRecord {
  id: string;
  ownerUserId: string;
  shares: WorkyStreamShareRecord[];
  workspaceId: string;
  artifactWorkspaceId: string | null;
  managerAgentId: string | null;
  managerModelId: string | null;
  workerModelId: string | null;
  voicePrompt: string | null;
  aiSessionId: string | null;
  governancePolicyRef: string | null;
  title: string;
  status: string;
  controlState: string;
  schedulerEnabled: boolean;
  currentPlanVersion: number;
  executionPlanVersion: number | null;
  budget: WorkyStreamBudget;
  startedAt: Date | null;
  completedAt: Date | null;
  activeDurationMinutes: number;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkyTaskBudget {
  estimateUsd: number;
  actualUsd: number;
  tokensEstimate: number;
  tokensActual: number;
}

type TaskRow = typeof schema.workyTasks.$inferSelect;

export type WorkyTaskRecord = Omit<
  TaskRow,
  'budgetEstimateUsd' | 'budgetActualUsd' | 'budgetTokensEstimate' | 'budgetTokensActual'
> & { budget: WorkyTaskBudget };

export type WorkyMessageRecord = typeof schema.workyMessages.$inferSelect;
export type WorkyMessageComponentRecord = typeof schema.workyMessageComponents.$inferSelect;
export type WorkyPlanStepComponentRecord = typeof schema.workyPlanStepComponents.$inferSelect;
export type WorkyPlanStepArtifactRecord = typeof schema.workyPlanStepArtifacts.$inferSelect;
export type WorkyPlanProjectionRecord = typeof schema.workyPlanProjections.$inferSelect;
export type WorkyInteractionRecord = typeof schema.workyInteractions.$inferSelect;
export type WorkyPlanDeltaRecord = typeof schema.workyPlanDeltas.$inferSelect;
export type WorkyPlanVersionRecord = typeof schema.workyPlanVersions.$inferSelect;
export type WorkyBudgetReservationRecord = typeof schema.workyBudgetReservations.$inferSelect;
export type WorkyCostEventRecord = typeof schema.workyCostEvents.$inferSelect;
export type WorkyTraceRecord = typeof schema.workyTraces.$inferSelect;
export type WorkyAuditEventRecord = typeof schema.workyAuditEvents.$inferSelect;
export type WorkyTaskResultRecord = typeof schema.workyTaskResults.$inferSelect;
export type WorkyEphemeralWorkerRecord = typeof schema.workyEphemeralWorkers.$inferSelect;
export type WorkyExecutionReportRecord = typeof schema.workyExecutionReports.$inferSelect;
export type WorkyScheduledEventRecord = typeof schema.workyScheduledEvents.$inferSelect;
export type WorkyGovernancePolicyRecord = typeof schema.workyGovernancePolicies.$inferSelect;
export type WorkyMemoryProposalRecord = typeof schema.workyMemoryProposals.$inferSelect;
export type WorkyMemoryEntryRecord = typeof schema.workyMemoryEntries.$inferSelect;
export type WorkyMailSubscriptionRecord = typeof schema.workyMailSubscriptions.$inferSelect;
export type WorkyElectricCursorRecord = typeof schema.workyElectricCursors.$inferSelect;
