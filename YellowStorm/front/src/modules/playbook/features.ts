export const playbookFeatures = {
  queryEnabled: import.meta.env.VITE_PLAYBOOK_QUERY_ENABLED === 'true',
  queryMutationsEnabled: import.meta.env.VITE_PLAYBOOK_QUERY_MUTATIONS_ENABLED === 'true',
} as const;
