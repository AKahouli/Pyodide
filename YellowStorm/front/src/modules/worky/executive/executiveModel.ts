import type {
  MessageComponent,
  WorkyCompanionSessionSummary,
  WorkyPendingClarification,
  WorkyPlanSummary,
  WorkyTask,
} from '../types';

/** A pending send/mail approval gate (a `confirm::` choice card still awaiting
 *  the owner's approve/decline). Surfaced in "Needs you" so it isn't missed. */
export interface WorkyPendingApproval {
  questionId: string;
  component: MessageComponent;
}

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
  openPrerequisites: WorkyTask[];
  canceledPrerequisites: number;
  unavailablePrerequisites: number;
  downstreamCount: number;
}

export interface WorkyDeliveryPath {
  task: WorkyTask;
  total: number;
  completed: number;
  blocked: number;
  nextTask: WorkyTask | null;
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
  blocked: number;
  remaining: number;
  waitingExternal: number;
  needsInput: number;
}

export interface WorkyExecutiveViewModel {
  plan: WorkyPlanSummary | null;
  session: WorkyCompanionSessionSummary | null;
  health: WorkyMissionHealth;
  runtimeAsks: WorkyRuntimeAttentionItem[];
  interactions: WorkyPendingClarification[];
  pendingApprovals: WorkyPendingApproval[];
  currentWork: WorkyCurrentWorkItem[];
  allTasks: WorkyTask[];
  completedTasks: WorkyTask[];
  deliveryPaths: WorkyDeliveryPath[];
  recentTasks: WorkyTask[];
  delegations: WorkyDelegationItem[];
  summary: WorkyExecutiveSummary;
}
