import { registerAs } from '@nestjs/config';

/**
 * App Builder runtime configuration.
 *
 * Target architecture: Runtime MCP + Broker live on YellowStorm; APImanus is
 * only the OpenCode gateway and calls internal bind for mcpUrl + mcpToken.
 */
export default registerAs('appRuntime', () => ({
  /** When false, POST /mcp/app-runtime returns 503. */
  mcpEnabled: process.env.APP_RUNTIME_MCP_ENABLED !== 'false',
  /**
   * Public MCP URL returned on bind. Prefer APP_RUNTIME_MCP_URL in production;
   * otherwise derived from APP_RUNTIME_PUBLIC_BASE_URL or localhost default.
   */
  mcpUrl: process.env.APP_RUNTIME_MCP_URL || '',
  publicBaseUrl: process.env.APP_RUNTIME_PUBLIC_BASE_URL || '',
  /**
   * Legacy: APImanus BrowserRuntimeAdapter HTTP POST /internal/app-runtime/tool-invoke.
   * Set false once APP_RUNTIME_MCP_LOCATION=yellowstorm is validated.
   */
  legacyToolInvokeEnabled: process.env.APP_RUNTIME_LEGACY_TOOL_INVOKE !== 'false',
  ticketTtlMs: parseInt(process.env.APP_RUNTIME_TICKET_TTL_MS || '60000', 10),
  heartbeatTimeoutMs: parseInt(
    process.env.APP_RUNTIME_HEARTBEAT_TIMEOUT_MS || '45000',
    10,
  ),
  toolTimeoutMs: parseInt(process.env.APP_RUNTIME_TOOL_TIMEOUT_MS || '180000', 10),
  mutationWaitMs: parseInt(
    process.env.APP_RUNTIME_MUTATION_WAIT_MS || '30000',
    10,
  ),
  starterRevisionId:
    process.env.APP_BUILDER_STARTER_REVISION_ID || 'starter_react_vite_v1',
  starterManifestKey:
    process.env.APP_BUILDER_STARTER_MANIFEST_KEY ||
    'appbuilder/manifests/_system/starter_react_vite_v1.json',
}));
