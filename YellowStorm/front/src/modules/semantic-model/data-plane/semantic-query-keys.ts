// Data-plane query keys: scoped by model + data revision so a later refresh
// can never mix revisions or overwrite an unsaved draft (P1.SB04).
export const semanticDataKeys = {
  all: (modelId: string) => ['semantic-models', 'data-plane', modelId] as const,
  summary: (modelId: string) =>
    [...semanticDataKeys.all(modelId), 'summary'] as const,
  entities: (modelId: string, dataRevision: string | null) =>
    [...semanticDataKeys.all(modelId), 'entities', dataRevision ?? 'unpinned'] as const,
  relations: (modelId: string, dataRevision: string | null) =>
    [...semanticDataKeys.all(modelId), 'relations', dataRevision ?? 'unpinned'] as const,
  reviews: (modelId: string) => [...semanticDataKeys.all(modelId), 'reviews'] as const,
  jobs: (modelId: string, jobId?: string) =>
    [...semanticDataKeys.all(modelId), 'jobs', jobId ?? 'all'] as const,
};
