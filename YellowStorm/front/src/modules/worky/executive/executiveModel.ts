import type {
  WorkyCompanionSessionSummary,
  WorkyPendingClarification,
  WorkyPlanSummary,
  WorkyTask,
} from '../types';

export type WorkyMissionHealth =
  | 'planning'
  | 'on_track'
  | 'needs_attention'
  | 'at_risk'
  | 'paused'
  | 'completed'
  | 'stopped';

export interface WorkyRuntimeAttentionItem {
  taskId: string;
  interruptId: string;
  question: string;
  active: boolean;
}

export type WorkyCurrentWorkStatus =
  | 'needs_input'
  | 'failed'
  | 'blocked'
  | 'running'
  | 'review'
  | 'pending'
  | 'waiting_external';

export interface WorkyCurrentWorkItem {
  task: WorkyTask;
  status: WorkyCurrentWorkStatus;
}

export interface WorkyDelegationItem {
  key: string;
  name: string;
  role: string | null;
  type: 'human' | 'ai';
  taskCount: number;
  activeCount: number;
}

export interface WorkyExecutiveSummary {
  total: number;
  completed: number;
  active: number;
  waitingExternal: number;
  needsInput: number;
}

export interface WorkyExecutiveViewModel {
  plan: WorkyPlanSummary | null;
  session: WorkyCompanionSessionSummary | null;
  health: WorkyMissionHealth;
  runtimeAsks: WorkyRuntimeAttentionItem[];
  interactions: WorkyPendingClarification[];
  currentWork: WorkyCurrentWorkItem[];
  delegations: WorkyDelegationItem[];
  summary: WorkyExecutiveSummary;
}
