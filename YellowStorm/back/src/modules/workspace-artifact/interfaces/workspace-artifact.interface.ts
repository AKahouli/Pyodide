import type { DecisionFlowPayload } from './decision-flow.interface';

export enum WorkspaceArtifactType { DECISION_FLOW = 'decision_flow' }
export enum WorkspaceArtifactStatus { QUEUED = 'queued', GENERATING = 'generating', READY = 'ready', FAILED = 'failed' }
export type DecisionFlowType = 'eligibility' | 'orientation' | 'guided_diagnostic' | 'procedure' | 'other';
export type DecisionFlowTargetAudience = 'business_creator' | 'artisan' | 'merchant' | 'existing_business' | 'infer_from_document';
export type DecisionFlowDetailLevel = 'synthetic' | 'standard' | 'detailed';
export interface DecisionFlowGenerationOptions {
  flowType: DecisionFlowType;
  customFlowType?: string;
  targetAudiences: DecisionFlowTargetAudience[];
  detailLevel: DecisionFlowDetailLevel;
  ambiguityPolicy: { doNotInvent: boolean; createToConfirmNodes: boolean; citeSourcePassages: boolean; identifyContradictions: boolean; };
}
export const DEFAULT_DECISION_FLOW_GENERATION_OPTIONS: DecisionFlowGenerationOptions = {
  flowType: 'eligibility',
  targetAudiences: ['infer_from_document'],
  detailLevel: 'standard',
  ambiguityPolicy: { doNotInvent: true, createToConfirmNodes: true, citeSourcePassages: true, identifyContradictions: true },
};
export interface WorkspaceArtifactResponse {
  id: string; workspaceId: string; type: WorkspaceArtifactType; name: string; description?: string; status: WorkspaceArtifactStatus; schemaVersion: number; revision: number;
  primarySource: { documentId: string; documentName: string; contentHash?: string; selection: { mode: 'all' } | { mode: 'pages'; pages: number[] } };
  generationOptions: DecisionFlowGenerationOptions;
  payload?: DecisionFlowPayload;
  generation: { agentId: string; requestedBy: string; attempts: number; startedAt?: string; completedAt?: string; error?: string };
  clonedFromArtifactId?: string; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
}
