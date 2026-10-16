/**
 * Internal MCP servers trusted with the acting user's identity (X-YellowStorm-* headers). A connector is
 * trusted by the server it points at, never by its slug: whoever creates it in the connector library, it
 * receives the identity only when its URL is one of these configured servers.
 */
const TRUSTED_MCP_SERVER_URL_KEYS = [
  'PLAYBOOK_MCP_SERVER_URL',
  'AGENT_MCP_SERVER_URL',
  'SEMANTIC_MODEL_MCP_SERVER_URL',
] as const;

interface ConfigReader {
  get<T = string>(key: string, fallback?: T): T | undefined;
}

/** Compare MCP server URLs without case or trailing slash differences. */
export function normalizeMcpServerUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\/+$/, '') : '';
}

export function trustedMcpServerUrls(config: ConfigReader | undefined): Set<string> {
  const configured = [
    ...TRUSTED_MCP_SERVER_URL_KEYS.map((key) => config?.get(key, '') ?? ''),
    ...(config?.get('TRUSTED_MCP_SERVER_URLS', '') ?? '').split(','),
  ];
  return new Set(configured.map(normalizeMcpServerUrl).filter(Boolean));
}

export function isTrustedMcpServerUrl(config: ConfigReader | undefined, url: unknown): boolean {
  const normalized = normalizeMcpServerUrl(url);
  return Boolean(normalized) && trustedMcpServerUrls(config).has(normalized);
}

/**
 * Service endpoints the backend actually signs MCP JWTs for (WP05.5): a
 * service URL counts as an egress-policy exception ONLY while its MCP auth
 * mode is JWT, because the exception contract requires service-issued JWT
 * authentication. Bearer-mode internal servers must satisfy the public
 * destination rules like any other endpoint.
 */
export function jwtCapableMcpServerUrls(config: ConfigReader | undefined): string[] {
  const entries: readonly [urlKey: string, modeKey: string][] = [
    ['PLAYBOOK_MCP_SERVER_URL', 'PLAYBOOK_MCP_AUTH_MODE'],
    ['AGENT_MCP_SERVER_URL', 'AGENT_MCP_AUTH_MODE'],
    ['SEMANTIC_MODEL_MCP_SERVER_URL', 'SEMANTIC_MODEL_MCP_AUTH_MODE'],
  ];
  return entries
    .filter(([, modeKey]) => (config?.get<string>(modeKey, 'Bearer') ?? 'Bearer') === 'JWT')
    .map(([urlKey]) => config?.get<string>(urlKey, '') ?? '')
    .filter(Boolean);
}
