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
  // Consumed by the browser runtime ticket endpoint (not issued yet).
  ticketTtlMs: parseInt(process.env.APP_RUNTIME_TICKET_TTL_MS || '60000', 10),
}));
