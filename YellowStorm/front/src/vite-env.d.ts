/// <reference types="vite/client" />
/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

interface ImportMetaEnv {
  readonly VITE_PLAYBOOK_DELTA_AUTOSAVE_ENABLED?: string;
  readonly VITE_PLAYBOOK_DEVTOOLS_ENABLED?: string;
  readonly VITE_PLAYBOOK_MCP_ASSISTANT_ENABLED?: string;
  readonly VITE_PLAYBOOK_AGENT_ASSISTANT_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const global: {
    basename: string
}
