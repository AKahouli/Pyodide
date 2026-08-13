import { registerAs } from '@nestjs/config';

/**
 * App Builder runtime configuration. The Runtime MCP endpoint itself lives in
 * APImanus for now (`/api/v1/opencode/runtime-mcp`), so `mcpUrl` is what the
 * internal bind endpoint hands back to the OpenCode gateway.
 */
export default registerAs('appRuntime', () => ({
  mcpUrl:
    process.env.APP_RUNTIME_MCP_URL ||
    'http://127.0.0.1:8000/api/v1/opencode/runtime-mcp',
  ticketTtlMs: parseInt(process.env.APP_RUNTIME_TICKET_TTL_MS || '60000', 10),
  /** A runtime without a heartbeat within this window is treated as offline. */
  heartbeatTimeoutMs: parseInt(
    process.env.APP_RUNTIME_HEARTBEAT_TIMEOUT_MS || '45000',
    10,
  ),
  /** Matches the default `timeoutMs` of the APImanus `run` tool input. */
  toolTimeoutMs: parseInt(process.env.APP_RUNTIME_TOOL_TIMEOUT_MS || '180000', 10),
  /** How long a mutation may wait for the workspace lock before giving up. */
  mutationWaitMs: parseInt(
    process.env.APP_RUNTIME_MUTATION_WAIT_MS || '30000',
    10,
  ),
  /**
   * Canonical Ceph starter revision assigned on first bind when the workspace
   * has no prior source revision. Must match the seeded Ceph manifest.
   */
  starterRevisionId:
    process.env.APP_BUILDER_STARTER_REVISION_ID || 'starter_react_vite_v1',
  starterManifestKey:
    process.env.APP_BUILDER_STARTER_MANIFEST_KEY ||
    'appbuilder/manifests/_system/starter_react_vite_v1.json',
}));
