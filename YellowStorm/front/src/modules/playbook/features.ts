export const playbookFeatures = {
  queryEnabled: import.meta.env.VITE_PLAYBOOK_QUERY_ENABLED === 'true',
  queryMutationsEnabled: import.meta.env.VITE_PLAYBOOK_QUERY_MUTATIONS_ENABLED === 'true',
  querySseEnabled: import.meta.env.VITE_PLAYBOOK_QUERY_SSE_ENABLED === 'true',
  querySseMirrorZustandEnabled: import.meta.env.VITE_PLAYBOOK_QUERY_SSE_MIRROR_ZUSTAND === 'true',
  xstateExecutionEnabled: import.meta.env.VITE_PLAYBOOK_XSTATE_EXECUTION_ENABLED === 'true',
} as const;
