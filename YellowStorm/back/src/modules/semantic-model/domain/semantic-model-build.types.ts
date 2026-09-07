export type SemanticModelBuildStatus = 'running' | 'completed' | 'failed';
export type SemanticModelBuildStep = 'ontology' | 'mapping' | 'apply';
export type SemanticModelBuildStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type SemanticModelBuildApplyMode = 'replace' | 'incremental';

export interface SemanticModelManualInstances {
  nodeTypeId: string;
  labels: string[];
}

export interface SemanticModelBuildJob {
  buildId: string;
  modelId: string;
  startedBy: string;
  status: SemanticModelBuildStatus;
  currentStep: SemanticModelBuildStep | null;
  ontologyStatus: SemanticModelBuildStepStatus;
  mappingStatus: SemanticModelBuildStepStatus;
  applyStatus: SemanticModelBuildStepStatus;
  applyMode: SemanticModelBuildApplyMode;
  mappingJobId: string | null;
  graphWarning: string | null;
  error: string | null;
  startedAt: string;
  ontologyCompletedAt: string | null;
  mappingCompletedAt: string | null;
  applyCompletedAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string;
}

export interface SemanticModelBuildStartRequest {
  businessRequirements: string[];
  applyMode: SemanticModelBuildApplyMode;
  manualInstances?: SemanticModelManualInstances[];
}

export interface SemanticModelBuildStartResponse {
  buildId: string;
  status: SemanticModelBuildStatus;
}
