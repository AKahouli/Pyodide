/// <reference types="vite/client" />
/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

interface ImportMetaEnv {
  readonly VITE_CONVERSATION_LATENCY_UI_ENABLED?: string;
  /** Global kill switch for generative UI: "true" lets agents with the genUiEnabled toggle answer in OpenUI Lang. */
  readonly VITE_OPENUI_RENDER_ENABLED?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_SOCKET_BASE_URL?: string;
  readonly VITE_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __APP_CONFIG__?: {
    API_URL?: string;
    SOCKET_BASE_URL?: string;
    [key: string]: unknown;
  };
}

declare const global: {
  basename: string;
};
