/**
 * The only MCP transports a backend HTTP caller may inspect or configure:
 * remote HTTP transports. Everything else (stdio and any unknown value) is
 * denied before any transport is constructed, so no API request can start a
 * caller-selected OS process (SEC-01 / WP-01).
 */
export const REMOTE_INSPECTABLE_MCP_TRANSPORTS = ['sse', 'streamable_http'] as const;

export type RemoteInspectableMcpTransport = (typeof REMOTE_INSPECTABLE_MCP_TRANSPORTS)[number];

export function isRemoteInspectableMcpTransport(value: unknown): value is RemoteInspectableMcpTransport {
  return typeof value === 'string'
    && (REMOTE_INSPECTABLE_MCP_TRANSPORTS as readonly string[]).includes(value);
}

/**
 * SERVER-ONLY input validation for connector endpoint URLs: rejects URLs that
 * embed credentials in the authority (user:pass@host) so secret material can
 * never enter connector storage through a URL (WP02.6).
 */
export function assertNoUrlCredentials(serverUrl: string): void {
  if (!serverUrl) return;
  let parsed: URL | null = null;
  try {
    parsed = new URL(serverUrl);
  } catch {
    parsed = null;
  }
  if (parsed && (parsed.username || parsed.password)) {
    throw new Error('MCP server URL must not contain embedded credentials');
  }
  if (!parsed && /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i.test(serverUrl)) {
    throw new Error('MCP server URL must not contain embedded credentials');
  }
}

/** Strip any userinfo from an endpoint URL before exposing it to clients. */
export function sanitizeEndpointUrl(serverUrl: string | null | undefined): string {
  if (!serverUrl) return serverUrl ?? '';
  try {
    const parsed = new URL(serverUrl);
    if (!parsed.username && !parsed.password) return serverUrl;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return serverUrl.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, '$1');
  }
}
