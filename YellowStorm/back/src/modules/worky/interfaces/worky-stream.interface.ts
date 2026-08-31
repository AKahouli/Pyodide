/**
 * Wire shape returned by the streams CRUD endpoints. Mirrors the canonical
 * §3.1 schema. All ids are stringified for JSON friendliness.
 */
export interface IWorkyStreamResponse {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  /** Legacy: null for streams created after the workspace/agent removal. */
  artifactWorkspaceId: string | null;
  /** Legacy: null for streams created after the workspace/agent removal. */
  managerAgentId: string | null;
  managerModelId?: string | null;
  workerModelId?: string | null;
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
 * Live per-stream task rollup aggregated from `worky_tasks` (by `lane`) for the
 * streams list. `progress` is `done / totalTasks` in the range 0..1 (0 when the
 * stream has no tasks yet).
 */
export interface IWorkyStreamStats {
  totalTasks: number;
  running: number;
  done: number;
  blocked: number;
  failed: number;
  progress: number;
}

/**
 * A stream list row: the canonical stream response plus its live task stats.
 */
export interface IWorkyStreamListItem extends IWorkyStreamResponse {
  stats: IWorkyStreamStats;
}

/**
 * Paginated envelope for `GET /worky/streams`. `statusCounts` maps each stream
 * status to how many of the owner's streams (within the current search/date
 * scope, ignoring the status filter) are in that status — powers the home-page
 * KPI tiles / filter chips accurately across pages.
 */
export interface IWorkyStreamListResult {
  data: IWorkyStreamListItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    statusCounts: Record<string, number>;
  };
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
