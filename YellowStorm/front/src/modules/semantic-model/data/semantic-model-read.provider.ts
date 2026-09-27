// P1.SB01 + P1.SB05: single read-provider boundary for the semantic feature.
// Components use this contract; they never issue raw Supabase/PostgREST calls.
// Classification is exhaustive over semanticModelApi (failing closed on unknown),
// so no route silently falls into generic CRUD. Commands stay on NestJS.

export type ReadKind = 'command' | 'curated-read' | 'evidence-read' | 'draft-local';

// Derived from the real client: adding a method to semanticModelApi without
// classifying it here is a compile error (Record must cover every key).
import type { semanticModelApi } from '../api';

export type SemanticApiCall = keyof typeof semanticModelApi;

export const CALL_CLASSIFICATION: Record<SemanticApiCall, ReadKind> = {
  list: 'curated-read',
  get: 'curated-read',
  graph: 'curated-read',
  workspaceDefault: 'curated-read',
  workspaceModels: 'curated-read',
  versions: 'curated-read',
  compareVersions: 'curated-read',
  bindings: 'curated-read',
  workspaces: 'curated-read',
  listShares: 'curated-read',
  listSourceAssets: 'curated-read',
  profileSourceAsset: 'curated-read',
  analyzeSourceAsset: 'command',
  listSourceMappings: 'curated-read',
  listRelationResolutionRules: 'curated-read',
  listSourceResolutionPolicies: 'curated-read',
  listIdentityRules: 'curated-read',
  readiness: 'curated-read',
  reviewItems: 'curated-read',
  create: 'command',
  update: 'command',
  archive: 'command',
  clone: 'command',
  applyOperations: 'command',
  validate: 'command',
  createBinding: 'command',
  deleteBinding: 'command',
  connectWorkspace: 'command',
  disconnectWorkspace: 'command',
  publish: 'command',
  restore: 'command',
  ensureWorkspaceDefault: 'command',
  share: 'command',
  updateShareRole: 'command',
  revokeShare: 'command',
  createSourceMapping: 'command',
  saveIdentityRule: 'command',
  deleteSourceMapping: 'command',
  createBulkDocumentSourceMappings: 'command',
  requestPopulationRefresh: 'command',
  getPopulationJob: 'curated-read',
  saveRelationResolutionRule: 'command',
  saveSourceResolutionPolicy: 'command',
  resolveReviewItem: 'command',
  dataToken: 'command',
  getAgeGraph: 'evidence-read',
  previewSourceMapping: 'evidence-read',
  previewRelationResolutionRule: 'evidence-read',
  dataPreview: 'evidence-read',
  listCorrections: 'curated-read',
  recordCorrection: 'command',
  undoCorrection: 'command',
  mappingHealth: 'evidence-read',
};

// Fail-closed: unknown calls are never treated as curated reads or commands.
export function resolveReadKind(call: string): ReadKind | 'unclassified' {
  return (CALL_CLASSIFICATION as Record<string, ReadKind>)[call] ?? 'unclassified';
}

export interface SemanticReadTarget {
  view: 'model' | 'sources' | 'data' | 'test';
  kind: ReadKind;
  // P1.SB04: every read carries scope/version so a later refresh cannot
  // overwrite an unsaved draft or mix revisions.
  modelId: string;
  modelVersionId: string | null;
  dataRevisionId: string | null;
}

export interface SemanticReadProvider<T = unknown> {
  key(target: SemanticReadTarget): unknown[];
  fetch(target: SemanticReadTarget): Promise<T>;
}

// Shared key builder: scope/version/revision are always part of the cache key.
export function readKey(target: SemanticReadTarget): unknown[] {
  return ['semantic-model', target.view, target.modelId, target.modelVersionId, target.dataRevisionId];
}
