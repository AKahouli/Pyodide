import { SelectedCorpusBinding } from './selected-corpus-manifest.types';

export interface SemanticModelEvidenceSearchTask {
  bindingId: string;
  target: SelectedCorpusBinding['target'];
  workspaceId: string;
  sourceDocumentId: string;
  fileName: string;
  text: string;
  /** Native passages returned by the Logical Search HTTP endpoint. */
  evidence: Array<{
    source: string;
    fileName: string;
    page?: string;
    quote?: string;
    workspaceId?: string;
    reference?: string;
  }>;
  toolResults: Array<{
    name: string;
    status: 'completed' | 'failed';
    result: unknown;
  }>;
}

export interface SemanticModelEvidenceSearchFailedUnit {
  bindingId: string;
  sourceDocumentId: string;
  fileName: string;
  error: string;
}

export interface SemanticModelEvidenceSearchResponse {
  modelId: string;
  searchedAt: string;
  tasks: SemanticModelEvidenceSearchTask[];
  failedUnits: SemanticModelEvidenceSearchFailedUnit[];
  summary: {
    searchedBindingCount: number;
    candidateDocumentCount: number;
    failedUnitCount: number;
  };
}
