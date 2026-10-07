
export class ControlEdge {
  id!: string;

  kind!: string;

  source!: string;

  target!: string;

  routerLabel?: string;

  sourceOutputPortId?: string;

  targetInputPortId?: string;

  priority?: number;
}

export class DataBinding {
  id!: string;

  targetNode!: string;

  targetPort!: string;

  sourceKind!: string;

  sourceNode?: string;

  sourcePort?: string;

  iteration?: string;

  triggerPath?: string;

  statePath?: string;

  constantValue?: unknown;

  expression?: string;
}
