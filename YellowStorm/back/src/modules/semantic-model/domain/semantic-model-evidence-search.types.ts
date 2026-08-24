import { SelectedCorpusBinding } from './selected-corpus-manifest.types';

export interface SemanticModelEvidenceSearchTask {
  bindingId: string;
  target: SelectedCorpusBinding['target'];
  workspaceId: string;
  sourceDocumentId: string;
  fileName: string;
  text: string;
  /** Native citations emitted by the ADK Search Agent / Logical Search MCP. */
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

export interface SemanticModelEvidenceSearchResponse {
  modelId: string;
  searchedAt: string;
  tasks: SemanticModelEvidenceSearchTask[];
  summary: {
    searchedBindingCount: number;
    candidateDocumentCount: number;
  };
}
