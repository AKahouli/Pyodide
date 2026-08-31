/**
 * Maps the legacy Mongo board/stream vocabularies onto the orchestrator
 * (companion_ai) status set the UI now shows. Frontend-only relabelling — the
 * backend board keeps its legacy lanes, so drag/drop and the move API are
 * unchanged; we just aggregate/translate for display.
 *
 * Orchestrator statuses:
 *   step/plan : pending · running · blocked · completed · failed
 *   session   : the above + waiting · paused
 */
import type { WorkyBoardLane, WorkyStreamStatus, WorkyTask } from './types';

export type OrchStepStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'canceled';
export type OrchSessionStatus = OrchStepStatus | 'waiting' | 'paused';

/** Board columns = the orchestrator step statuses, left→right. `canceled` is a
 * terminal column that holds the tasks of a stopped run. */
export const ORCH_LANES: OrchStepStatus[] = [
  'pending',
  'running',
  'blocked',
  'completed',
  'failed',
  'canceled',
];

/** Legacy board lane → orchestrator status. */
const LANE_TO_ORCH: Record<WorkyBoardLane, OrchStepStatus> = {
  backlog: 'pending',
  ready: 'pending',
  running: 'running',
  review: 'running',
  blocked: 'blocked',
  failed: 'failed',
  done: 'completed',
  canceled: 'canceled',
};

/** Canonical legacy lane a drop onto an orchestrator column maps back to. */
const ORCH_TO_LANE: Record<OrchStepStatus, WorkyBoardLane> = {
  pending: 'backlog',
  running: 'running',
  blocked: 'blocked',
  completed: 'done',
  failed: 'failed',
  canceled: 'canceled',
};

export function laneToOrch(lane: WorkyBoardLane): OrchStepStatus {
  return LANE_TO_ORCH[lane] ?? 'pending';
}

export function orchDropLane(orch: OrchStepStatus): WorkyBoardLane {
  return ORCH_TO_LANE[orch];
}

/** Aggregate the legacy board (7 lanes) into the 5 orchestrator columns. */
export function toOrchColumns(
  board: Record<WorkyBoardLane, WorkyTask[]> | null,
): Record<OrchStepStatus, WorkyTask[]> {
  const out: Record<OrchStepStatus, WorkyTask[]> = {
    pending: [],
    running: [],
    blocked: [],
    completed: [],
    failed: [],
    canceled: [],
  };
  if (!board) return out;
  (Object.keys(board) as WorkyBoardLane[]).forEach((lane) => {
    const tasks = board[lane];
    if (tasks?.length) out[laneToOrch(lane)].push(...tasks);
  });
  return out;
}

/** Legacy stream status → orchestrator session status. */
export function streamStatusToOrch(status?: WorkyStreamStatus): OrchSessionStatus {
  switch (status) {
    case 'planning':
    case 'start_requested':
    case 'active':
      return 'running';
    case 'partially_blocked':
      return 'blocked';
    case 'waiting_for_owner':
    case 'waiting_for_human':
    case 'waiting_for_budget_decision':
      return 'waiting';
    case 'paused':
      return 'paused';
    case 'stopped':
      // A stopped run is terminal-but-not-successful — mirror its canceled tasks.
      return 'canceled';
    case 'completed':
    case 'archived':
      return 'completed';
    case 'start_validation_failed':
      return 'failed';
    case 'created':
    default:
      return 'pending';
  }
}
