/**
 * Wire shape returned by the streams CRUD endpoints. Mirrors the canonical
 * §3.1 schema. All ids are stringified for JSON friendliness.
 */
export interface IWorkyStreamResponse {
  id: string;
  ownerUserId: string;
  access: 'owner' | 'write' | 'read';
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
      attentionCount: number;
  };
}

export interface IWorkyStreamShareResponse {
  id: string;
  permission: 'read' | 'write';
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}
