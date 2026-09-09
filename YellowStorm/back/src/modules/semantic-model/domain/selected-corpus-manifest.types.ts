export type CorpusBindingTargetKind = 'model' | 'node_type' | 'relation_type' | 'record';
export type CorpusResourceKind = 'workspace' | 'document';
export type CorpusRetrievalMode = 'broad' | 'targeted' | 'evidence_only';
export type CorpusIndexingStatus = 'none' | 'pending' | 'processing' | 'ready' | 'failed';

export interface SelectedCorpusDocument {
  sourceDocumentId: string;
  workspaceId: string;
  originalName: string;
  mimeType: string;
  indexingStatus: CorpusIndexingStatus;
  lastIndexedAt?: string;
}

export interface SelectedCorpusExclusion {
  bindingId: string;
  workspaceId: string;
  documentId?: string;
  reason: 'binding_unavailable' | 'document_not_found' | 'document_not_indexed' | 'folder';
}

export interface SelectedCorpusBinding {
  bindingId: string;
  target: {
    kind: CorpusBindingTargetKind;
    id?: string;
    label: string;
  };
  resourceKind: CorpusResourceKind;
  workspaceId: string;
  documentId?: string;
  retrievalMode: CorpusRetrievalMode;
  priority: number;
  documents: SelectedCorpusDocument[];
}

export interface SelectedCorpusManifest {
  modelId: string;
  preparedAt: string;
  bindings: SelectedCorpusBinding[];
  excluded: SelectedCorpusExclusion[];
  summary: {
    bindingCount: number;
    documentCount: number;
    excludedCount: number;
  };
}
