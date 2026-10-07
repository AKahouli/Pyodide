import type { AiExtractionSettings, SourceFieldMapping } from './semantic-source-mapping.types';

/** Named settings for reading a concept from documents, copied into a mapping when applied. */
export interface MappingPreset {
  id: string;
  conceptId: string;
  name: string;
  description: string | null;
  fieldMappings: SourceFieldMapping[];
  aiSettings: Partial<AiExtractionSettings>;
  identityFields: string[];
  updatedAt: string;
}

/** The settings of the document mapping of a concept saved most recently, to start a new one from. */
export interface LastDocumentMapping {
  mappingId: string;
  scope: 'document' | 'workspace';
  /** The document or workspace selection it reads; null when its workspace is no longer linked. */
  sourceName: string | null;
  workspaceLinked: boolean;
  fieldMappings: SourceFieldMapping[];
  aiSettings: Partial<AiExtractionSettings>;
  identityFields: string[];
  updatedAt: string;
}
