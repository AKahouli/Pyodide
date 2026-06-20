export const workyKeys = {
  all: ['worky'] as const,
  lists: () => [...workyKeys.all, 'list'] as const,
  list: (query: unknown) => [...workyKeys.lists(), query] as const,
  detail: (id: string) => [...workyKeys.all, 'detail', id] as const,
  events: (id: string) => [...workyKeys.detail(id), 'events'] as const,
  messages: (id: string) => [...workyKeys.detail(id), 'messages'] as const,
  board: (id: string) => [...workyKeys.detail(id), 'board'] as const,
  taskResults: (id: string) => [...workyKeys.all, 'task-results', id] as const,
  budget: (id: string) => [...workyKeys.detail(id), 'budget'] as const,
  report: (id: string) => [...workyKeys.detail(id), 'report'] as const,
  memoryProposals: (status?: string) =>
    [...workyKeys.all, 'memory', 'proposals', status ?? 'all'] as const,
  memoryEntries: () => [...workyKeys.all, 'memory', 'entries'] as const,
  governancePolicy: (workspaceId: string) =>
    [...workyKeys.all, 'governance-policy', workspaceId] as const,
};
