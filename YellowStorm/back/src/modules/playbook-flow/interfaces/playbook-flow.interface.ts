import { FlowNode, ControlEdge, DataBinding, FlowTriggerConfig, FlowSettings, type AdvisorScoringMode } from '../schemas/playbook-flow.schema';

export interface IFlowActiveReplay {
  id: string;
  validationVersion: number;
  isStale: boolean;
  staleReasons: string[];
  preserveOutputFormat: boolean;
  outputFormatGuide: string | null;
  formatGuideStatus: string | null;
  label: string | null;
  latestOverallScore: number | null;
}

export interface IFlowResponse {
  id: string;
  ownerId: string;
  schemaVersion: number;
  name: string;
  description?: string;
  executionStatus?: 'queued' | 'running' | 'pending_approval' | 'completed' | 'failed' | 'cancelled' | null;
  lastExecutionAt?: Date | null;
  triggerConfig?: FlowTriggerConfig;
  settings: FlowSettings;
  nodes: FlowNode[];
  controlEdges: ControlEdge[];
  dataBindings: DataBinding[];
  workspaces: string[];
  reflectionEnabled?: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
  activeReplays: Record<string, IFlowActiveReplay>;
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
