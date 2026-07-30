/**
 * Wire shape returned by the streams CRUD endpoints. Mirrors the canonical
 * §3.1 schema. All ids are stringified for JSON friendliness.
 */
export interface IWorkyStreamResponse {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  artifactWorkspaceId: string;
  managerAgentId: string;
  managerModelId?: string | null;
  workerModelId?: string | null;
  plannerModelId?: string | null;
  executorModelId?: string | null;
  plannerPrompt?: string | null;
  executorPrompt?: string | null;
  governancePolicyRef?: string | null;
  title: string;
  status: string;
  controlState: string;
  schedulerEnabled: boolean;
  currentPlanVersion: number;
  executionPlanVersion?: number | null;
  budget: {
    limitUsd: number;
    limitTokens: number;
    spendUsd: number;
    tokensUsed: number;
    enforcement: 'hard_stop' | 'notify';
  };
  startedAt?: string | null;
  completedAt?: string | null;
  activeDurationMinutes: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

/**
 * Generic ack shape returned by the internal-callback controller. Every
 * `/worky/internal/*` endpoint responds with this — `applied: true` is a
 * stub for Part 1; Parts 2/3/4 replace it with the actual outcome.
 */
export interface IWorkyCallbackAck {
  applied: boolean;
  replay: boolean;
  eventId: string;
  receivedAt: string;
}

/**
 * Plan-delta specific ack. The runtime reads `resultPlanVersion` so the
 * next planning turn can use the new version as its `basePlanVersion`.
 */
export interface IWorkyPlanDeltaAck extends IWorkyCallbackAck {
  resultPlanVersion: number;
  planDeltaId: string;
  createdTaskIds: string[];
  updatedTaskIds: string[];
  cancelledTaskIds: string[];
  clarificationIds: string[];
}
