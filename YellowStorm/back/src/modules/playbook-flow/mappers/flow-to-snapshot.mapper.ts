import { Flow, FlowNode, ControlEdge, DataBinding } from '../schemas/playbook-flow.schema';

export interface FlowSnapshot {
  nodes: FlowNode[];
  controlEdges: ControlEdge[];
  dataBindings: DataBinding[];
  settings: {
    recursionLimit: number;
    maxParallelism: number;
  };
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
  };
}
