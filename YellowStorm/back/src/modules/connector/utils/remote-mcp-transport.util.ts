import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

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

/** Strict parser shared by input validation and public projection; never echoes input. */
function parseEndpoint(value: string): URL | null {
  if (value.trim() !== value || /[\s\\\u0000-\u001f\u007f]/u.test(value)
    || /%(?![\da-f]{2})/i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname
      || /%(?:25)*(?:3f|23|40)/i.test(parsed.pathname)) return null;
    decodeURIComponent(parsed.pathname); // Invalid UTF-8 is not a displayable endpoint.
    return parsed;
  } catch { return null; }
}

/** New endpoints never use URL components as credential storage (R03). */
export function assertNoUrlCredentials(serverUrl: string): void {
  if (!serverUrl) return;
  const parsed = parseEndpoint(serverUrl);
  if (!parsed || parsed.username || parsed.password || serverUrl.includes('?') || serverUrl.includes('#')) {
    throw new BadRequestException(
      ErrorCode.BAD_REQUEST,
      'MCP server URL must be a valid HTTP(S) endpoint without embedded credentials, query or fragment',
    );
  }
}

/** Display-only URL. Never use this to silently rewrite a runtime destination. */
export function sanitizeEndpointUrl(serverUrl: string | null | undefined): string {
  if (!serverUrl) return '';
  const parsed = parseEndpoint(serverUrl);
  if (!parsed) return '';
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

/**
 * Metadata-only defense in depth after a structural DTO allowlist. Remove known
 * endpoint credentials even when copied outside the URL, and parse embedded URLs
 * rather than trusting their query names. Runtime/header objects must not enter
 * this function as a substitute for omitting them from public DTOs.
 */
export function sanitizeMcpPublicMetadata<T>(value: T, endpoint?: string | null): T {
  const secrets = new Set<string>();
  let unclassifiedEndpoint = false;
  const remember = (secret: string) => {
    if (!secret) return;
    secrets.add(secret);
    secrets.add(encodeURIComponent(secret));
    try { secrets.add(decodeURIComponent(secret)); } catch { /* opaque legacy value */ }
  };
  try {
    const url = new URL(endpoint ?? '');
    remember(url.username);
    remember(url.password);
    for (const secret of url.searchParams.values()) remember(secret);
    remember(url.hash.slice(1));
  } catch {
    unclassifiedEndpoint = Boolean(endpoint);
    // Recover only secret candidates, never a public URL, from malformed legacy
    // records. URLSearchParams tolerates malformed escapes without echoing them.
    const raw = endpoint ?? '';
    const query = raw.indexOf('?');
    if (query >= 0) for (const secret of new URLSearchParams(raw.slice(query + 1).split('#')[0]).values()) remember(secret);
    const fragment = raw.indexOf('#');
    if (fragment >= 0) remember(raw.slice(fragment + 1));
  }
  const ordered = [...secrets].sort((a, b) => b.length - a.length);
  const text = (input: string): string => {
    // If the credential envelope cannot be classified, there is no safe basis
    // for deciding which copied words are credentials. Suppress free text;
    // do not add another permissive credential-recovery regex.
    if (unclassifiedEndpoint) return input ? '[redacted]' : '';
    // A malformed escape must not disable decoding of preceding secret bytes.
    // Conservatively suppress mixed encoded/malformed metadata rather than
    // returning its undecodable original content.
    if (/%[\da-f]{2}/i.test(input) && /%(?![\da-f]{2})/i.test(input)) return '[redacted]';
    let decoded = input;
    for (let layer = 0; layer < 3 && decoded.includes('%'); layer++) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
        if (ordered.some(secret => decoded.includes(secret))) return '[redacted]';
        if (/https?:\/\//i.test(decoded)) return '[redacted]';
        if (layer === 2 && /%[\da-f]{2}/i.test(decoded)) return '[redacted]';
      } catch { return '[redacted]'; }
    }
    let output = endpoint ? input.split(endpoint).join(sanitizeEndpointUrl(endpoint)) : input;
    output = output.replace(/https?:\/\/[^\s<>"'`]+/gi, url => sanitizeEndpointUrl(url));
    for (const secret of ordered) output = output.split(secret).join('[redacted]');
    return output.replace(/\bbearer\s+[^\s"',;]+/gi, 'Bearer [redacted]');
  };
  const walk = (input: unknown, depth: number): unknown => {
    if (depth > 32) return null;
    if (typeof input === 'string') return text(input);
    if (Array.isArray(input)) return input.map(child => walk(child, depth + 1));
    if (!input || typeof input !== 'object' || input instanceof Date) return input;
    return Object.fromEntries(Object.entries(input).filter(([key]) => text(key) === key)
      .map(([key, child]) => [key, walk(child, depth + 1)]));
  };
  return walk(value, 0) as T;
}
