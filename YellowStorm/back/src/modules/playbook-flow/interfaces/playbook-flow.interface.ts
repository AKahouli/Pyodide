import { FlowNode, ControlEdge, DataBinding, FlowTriggerConfig, FlowSettings } from '../schemas/playbook-flow.schema';

export interface IFlowResponse {
  id: string;
  ownerId: string;
  schemaVersion: number;
  name: string;
  description?: string;
  triggerConfig?: FlowTriggerConfig;
  settings: FlowSettings;
  nodes: FlowNode[];
  controlEdges: ControlEdge[];
  dataBindings: DataBinding[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IFlowListResponse {
  items: IFlowResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
