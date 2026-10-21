import { SetMetadata } from '@nestjs/common';

// Pure route-audience metadata, kept dependency-free: controller decorators may
// evaluate during partially-initialized import cycles, so this file must not
// pull the guard (and its backend service graph) into module scope.
export const MCP_ROUTE_AUDIENCE_METADATA = 'yellowstorm:mcp-route-audience';

export const ROUTE_PRINCIPALS: Record<string, string> = {
  'mcp-agent': 'mcp-agent',
  'mcp-playbook': 'mcp-playbook',
  'mcp-semantic-model': 'semantic-model-mcp',
  'mcp-platform': 'mcp-platform',
  'mcp-pyodide': 'mcp-pyodide',
};
export type McpRouteAudienceValue = 'mcp-agent' | 'mcp-playbook' | 'mcp-semantic-model' | 'mcp-platform' | 'mcp-pyodide';
/**
 * Declare the trusted assertion audience(s) for an internal MCP surface in code.
 * Multiple audiences exist only for the platform-MCP migration: legacy per-server
 * audiences and the shared `mcp-platform` audience are accepted until the old
 * deployments retire, then each list collapses back to one entry.
 */
export const McpRouteAudience = (...audiences: McpRouteAudienceValue[]) => {
  if (!audiences.length || audiences.some((audience) => !ROUTE_PRINCIPALS[audience])) {
    throw new Error('McpRouteAudience requires trusted audiences');
  }
  return SetMetadata(MCP_ROUTE_AUDIENCE_METADATA, audiences);
};
