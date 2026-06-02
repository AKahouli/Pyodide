import { Flow, FlowNode, ControlEdge, DataBinding } from '../schemas/playbook-flow.schema';
import { HitlBlockerRule, HitlPolicy } from '../schemas/playbook-flow-hitl.schema';

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

export function flowToSnapshot(flow: Flow): FlowSnapshot {
  return {
    nodes: flow.nodes,
    controlEdges: flow.controlEdges,
    dataBindings: flow.dataBindings,
    settings: {
      recursionLimit: flow.settings.recursionLimit,
      maxParallelism: flow.settings.maxParallelism,
    },
    hitlPolicy: flow.hitlPolicy,
    hitlBlockers: flow.hitlBlockers || [],
    workspaces: (flow.workspaces || []).map((w: any) =>
      typeof w === 'object' && w.toString ? w.toString() : String(w),
    ),
  };
}
