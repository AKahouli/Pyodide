/**
 * App Builder browser-runtime feature flag (Vague 5).
 *
 * When true (default): Conversation V2 boots BrowserRuntimeHost + Socket.IO ticket.
 * When `VITE_APP_RUNTIME_ENABLED=false`: fall back to legacy Nodepod-only boot from
 * cephPath (no runtime ticket / MCP binding) so already-generated apps keep working.
 */
export const appRuntimeEnabled =
  import.meta.env.VITE_APP_RUNTIME_ENABLED !== 'false';
