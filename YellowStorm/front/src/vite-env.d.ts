/// <reference types="vite/client" />
/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

interface ImportMetaEnv {
  readonly VITE_SECOND_BRAIN_ENABLED?: string;
  readonly VITE_PLAYBOOK_DELTA_AUTOSAVE_ENABLED?: string;
  readonly VITE_PLAYBOOK_DEVTOOLS_ENABLED?: string;
  readonly VITE_PLAYBOOK_MCP_ASSISTANT_ENABLED?: string;
  readonly VITE_PLAYBOOK_AGENT_ASSISTANT_ENABLED?: string;
  /** Set to "false" to force legacy Nodepod boot without Socket.IO runtime ticket. */
  readonly VITE_APP_RUNTIME_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const global: {
    basename: string
}
