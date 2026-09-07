import type { SemanticModelEvidenceSearchTask } from './semantic-model-evidence-search.types';

export type SemanticModelMappingJobStatus = 'running' | 'completed' | 'failed';

export interface SemanticModelMappingJob {
  jobId: string;
  modelId: string;
  status: SemanticModelMappingJobStatus;
  startedAt: string;
  completedAt?: string;
  result?: SemanticModelMappingProposalResponse;
  /** Evidence tasks stored at generate time — used by applyMappingPlan to resolve source documents. */
  evidenceTasks?: SemanticModelEvidenceSearchTask[];
  error?: string;
}

export interface SemanticModelMappingPlan {
  nodes: Array<{
    id: string;
    nodeTypeId: string;
    label: string;
    /** Stable UUID of the matching existing record, returned by the ADK when it recognises the entity. Null for new entities. */
    entityKey?: string | null;
    attributes: Array<{ key: string; value: string | number | boolean; evidenceReferences: string[] }>;
    evidenceReferences: string[];
    confidence: number;
  }>;
  edges: Array<{
    id: string;
    relationTypeId: string;
    sourceNodeId: string;
    targetNodeId: string;
    evidenceReferences: string[];
    confidence: number;
  }>;
  mergeGroups: Array<{ canonicalNodeId: string; mergedNodeIds: string[]; reason: string }>;
}

export interface SemanticModelMappingProposalResponse {
  modelId: string;
  generatedAt: string;
  search: { searchedBindingCount: number; candidateDocumentCount: number };
  plan: SemanticModelMappingPlan;
  proposals: [];
  /** Internal field: evidence tasks carried from generate() so applyMappingPlan can resolve source documents. Not exposed via API. */
  _evidenceTasks?: SemanticModelEvidenceSearchTask[];
}
