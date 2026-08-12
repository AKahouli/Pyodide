export const semanticModelQueryKeys = {
  all: ['semantic-models'] as const,
  catalog: (filters: Record<string, unknown>) => ['semantic-models','catalog',filters] as const,
  model: (id: string) => ['semantic-models','model',id] as const,
  graph: (id: string) => ['semantic-models','graph',id] as const,
  bindings: (id: string) => ['semantic-models','bindings',id] as const,
  workspaces: (id: string) => ['semantic-models','workspaces',id] as const,
  versions: (id: string) => ['semantic-models','versions',id] as const,
  workspace: (id: string) => ['semantic-models','workspace-entry',id] as const,
};
