export function resolvePlaybookFeatureFlag(buildValue: string | undefined, runtimeValue: string, development = import.meta.env.DEV): boolean {
  return (development ? buildValue : runtimeValue) === 'true';
}

export const playbookFeatures = {
  queryEnabled: import.meta.env.VITE_PLAYBOOK_QUERY_ENABLED === 'true',
  queryMutationsEnabled: import.meta.env.VITE_PLAYBOOK_QUERY_MUTATIONS_ENABLED === 'true',
  querySseEnabled: import.meta.env.VITE_PLAYBOOK_QUERY_SSE_ENABLED === 'true',
  querySseMirrorZustandEnabled: import.meta.env.VITE_PLAYBOOK_QUERY_SSE_MIRROR_ZUSTAND === 'true',
  xstateExecutionEnabled: import.meta.env.VITE_PLAYBOOK_XSTATE_EXECUTION_ENABLED === 'true',
  xstateAutosaveEnabled: import.meta.env.VITE_PLAYBOOK_XSTATE_AUTOSAVE_ENABLED === 'true',
  asyncDesignEnabled: import.meta.env.VITE_PLAYBOOK_ASYNC_DESIGN_ENABLED === 'true',
  mcpAssistantEnabled: resolvePlaybookFeatureFlag(
    import.meta.env.VITE_PLAYBOOK_MCP_ASSISTANT_ENABLED,
    'MY_APP_VITE_PLAYBOOK_MCP_ASSISTANT_ENABLED',
  ),
  agentAssistantEnabled: resolvePlaybookFeatureFlag(
    import.meta.env.VITE_PLAYBOOK_AGENT_ASSISTANT_ENABLED,
    'MY_APP_VITE_PLAYBOOK_AGENT_ASSISTANT_ENABLED',
  ),
} as const;
