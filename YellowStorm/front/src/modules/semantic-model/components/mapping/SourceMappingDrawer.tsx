import type { KnowledgeResource } from '../../hooks/use-knowledge-linking';
import type { ConceptSourceMapping } from '../../types';
import { DocumentSourceMappingDrawer } from './DocumentSourceMappingDrawer';
import { SheetSourceMappingDrawer } from './SheetSourceMappingDrawer';
import type { SuggestionSource } from '../editor/SuggestConceptsDialog';

export interface SourceMappingTarget {
  workspaceId: string;
  documentId: string;
  documentName: string;
  assetKind: 'excel_sheet' | 'csv' | 'document';
  mimeType?: string;
  path?: string;
  conceptId?: string;
  mapping?: ConceptSourceMapping;
  bulkEdit?: boolean;
  /** Map many files of this workspace at once: all of them, or picked folders and files. */
  workspace?: WorkspaceSourceScope;
}

export interface WorkspaceSourceScope {
  workspaceId: string;
  /** The name shown for the source ("Legal", or "Legal / Contracts" when opened from a folder). */
  name: string;
  /** The workspace's own name, for "every file in …". */
  workspaceName?: string;
  /** Opened from a folder: that folder starts picked. */
  folderId?: string | null;
  /** What is picked to start with; nothing means the whole workspace. */
  folderIds?: string[];
  documentIds?: string[];
}

/** A target that maps many readable files of a workspace with one mapping. */
export function sourceMappingTargetFromWorkspace(scope: WorkspaceSourceScope, conceptId?: string): SourceMappingTarget {
  return {
    workspaceId: scope.workspaceId,
    documentId: `workspace:${scope.workspaceId}:${scope.folderId || 'all'}`,
    documentName: scope.name,
    assetKind: 'document',
    conceptId,
    workspace: scope,
  };
}

export function sourceMappingTargetFromResource(resource: Extract<KnowledgeResource, { kind: 'document' }>, conceptId?: string): SourceMappingTarget {
  return {
    workspaceId: resource.workspaceId,
    documentId: resource.documentId,
    documentName: resource.name,
    assetKind: resource.structured ? (resource.mimeType?.includes('csv') ? 'csv' : 'excel_sheet') : 'document',
    mimeType: resource.mimeType,
    path: resource.path,
    conceptId,
  };
}

/** Documents and sheets share one field mapping (see FieldMappingList); each drawer knows its source. */
export function SourceMappingDrawer({ onSuggestConcepts, ...props }: Readonly<{ modelId: string; target: SourceMappingTarget | null; onClose: () => void; onSuggestConcepts?: (source: SuggestionSource) => void }>) {
  if (props.target?.assetKind === 'document') return <DocumentSourceMappingDrawer {...props} />;
  return <SheetSourceMappingDrawer {...props} onSuggestConcepts={onSuggestConcepts} />;
}