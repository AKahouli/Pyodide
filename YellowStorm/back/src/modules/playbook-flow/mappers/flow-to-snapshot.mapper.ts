import type { FlowNode, ControlEdge, DataBinding } from '../models/playbook-flow.model';
import type { HitlBlockerRule, HitlPolicy } from '../models/playbook-flow-hitl.model';
import type { FlowRecord } from '../persistence/flow.repository';

export interface FlowSnapshot {
  nodes: FlowNode[];
  controlEdges: ControlEdge[];
  dataBindings: DataBinding[];
  settings: {
    recursionLimit: number;
    maxParallelism: number;
  };
  hitlPolicy?: HitlPolicy;
  hitlBlockers?: HitlBlockerRule[];
  workspaces: string[];
}

function filterRuntimeHitlBlockers(blockers: HitlBlockerRule[] | undefined): HitlBlockerRule[] {
  return (blockers ?? []).filter((blocker) => (blocker?.enabled) && blocker?.createdBy === 'user');
}

export type FlowSnapshotSource = Pick<FlowRecord, 'nodes' | 'controlEdges' | 'dataBindings' | 'settings' | 'hitlPolicy' | 'hitlBlockers' | 'workspaces'>;

export function flowToSnapshot(flow: FlowSnapshotSource): FlowSnapshot {
  return {
    nodes: flow.nodes,
    controlEdges: flow.controlEdges,
    dataBindings: flow.dataBindings,
    settings: {
      recursionLimit: flow.settings.recursionLimit,
      maxParallelism: flow.settings.maxParallelism,
    },
    hitlPolicy: flow.hitlPolicy,
    hitlBlockers: filterRuntimeHitlBlockers(flow.hitlBlockers),
    workspaces: [...(flow.workspaces ?? [])],
  };
}
