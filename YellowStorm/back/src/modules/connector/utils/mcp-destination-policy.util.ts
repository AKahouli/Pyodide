import { Resolver } from 'dns/promises';
import { isIP } from 'net';

/**
 * Centralized egress policy for server-side MCP probes of user-configured
 * destinations (SEC-06 / WP-05). Every remote MCP inspection and runtime tool
 * call must pass its destination through {@link assertMcpDestinationAllowed}
 * BEFORE any transport or HTTP request is constructed.
 *
 * Application-side filtering is defense in depth: WP05.6 network egress rules
 * remain the primary containment for DNS-rebinding races this validator
 * cannot close — it validates at resolution time while the MCP SDK resolves
 * again at connect time and does not support address pinning.
 */

export type McpDestinationDenialReason =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'embedded_credentials'
  | 'fragment_present'
  | 'malformed_percent_encoding'
  | 'port_not_allowed'
  | 'insecure_http'
  | 'missing_hostname'
  | 'dns_failure'
  | 'forbidden_address'
  | 'no_addresses';

const REASON_MESSAGES: Record<McpDestinationDenialReason, string> = {
  invalid_url: 'The MCP server URL is not a valid URL.',
  unsupported_scheme: 'Only http and https MCP server URLs are supported.',
  embedded_credentials: 'MCP server URL must not contain embedded credentials.',
  fragment_present: 'MCP server URL must not contain a fragment.',
  malformed_percent_encoding: 'MCP server URL contains malformed percent-encoding.',
  port_not_allowed: 'The MCP server URL uses a port that is not allowed for inspection.',
  insecure_http: 'MCP inspection requires https for this destination.',
  missing_hostname: 'The MCP server URL has no hostname.',
  dns_failure: 'The MCP server hostname could not be resolved.',
  forbidden_address: 'The MCP server destination resolves to a forbidden address.',
  no_addresses: 'The MCP server hostname resolved to no usable addresses.',
};

export class McpDestinationPolicyError extends Error {
  readonly reason: McpDestinationDenialReason;
  /** Normalized destination host for non-sensitive telemetry (WP05.7). */
  readonly host: string;

  constructor(reason: McpDestinationDenialReason, host: string) {
    super(REASON_MESSAGES[reason]);
    this.name = 'McpDestinationPolicyError';
    this.reason = reason;
    this.host = host;
  }
}

export interface McpDestinationPolicyOptions {
  /** Ports a user-configured MCP destination may use. Defaults to 80/443/8443. */
  allowedPorts?: number[];
  /** Allow plain http (development only). Defaults to false (https-only). */
  allowInsecureHttp?: boolean;
  /**
   * Exact admin-configured internal service endpoints (WP05.5): an exact
   * canonical match skips the DNS/forbidden-range and port rules because the
   * endpoint is a fixed private-network rule reached with service-issued
   * JWTs. Lookalike URLs inherit nothing.
   */
  allowExactEndpoints?: string[];
  /** DNS resolver; overridable for tests. */
  resolver?: Pick<Resolver, 'resolve4' | 'resolve6'>;
}

const DEFAULT_PORTS = [80, 443, 8443];

const DEFAULT_RESOLVER = new Resolver({ timeout: 3000, tries: 2 });

/** Loopback, unspecified, RFC1918, CGNAT 100.64/10, benchmarking 198.18/15, link-local
 * (includes cloud metadata 169.254.169.254), reserved/documentation ranges, multicast,
 * reserved-for-future and broadcast, plus the Azure platform address 168.63.129.16 (WP05.2). */
const FORBIDDEN_IPV4_RANGES: readonly { network: number; bits: number }[] = (
  [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
    ['168.63.129.16', 32],
  ] as const
).map(([base, bits]) => ({ network: ipv4ToInt(base), bits }));

/** Unspecified/IPv4-compatible, loopback, IPv4-mapped (range and per-address),
 * link-local, ULA (includes the AWS IPv6 metadata endpoint fd00:ec2::254),
 * multicast and documentation ranges. */
const FORBIDDEN_IPV6_RANGES: readonly { network: bigint; bits: number }[] = (
  [
    ['::', 96], ['::1', 128], ['::ffff:0:0', 96],
    ['fe80::', 10], ['fc00::', 7], ['ff00::', 8], ['2001:db8::', 32],
  ] as const
).map(([base, bits]) => ({ network: ipv6ToBigInt(base), bits }));

function ipv4ToInt(address: string): number {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv6ToBigInt(address: string): bigint {
  const [head, tail] = address.split('::') as [string, string | undefined];
  const headGroups = head ? head.split(':').filter(Boolean) : [];
  const tailGroups = tail !== undefined ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tailGroups];
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(Number.parseInt(group || '0', 16));
  return value;
}

function inSubnet(value: number, network: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return ((value ^ network) & mask) === 0;
}

function inSubnet6(value: bigint, network: bigint, bits: number): boolean {
  if (bits === 0) return true;
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return ((value ^ network) & mask) === 0n;
}

export function isForbiddenEgressIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  return FORBIDDEN_IPV4_RANGES.some(({ network, bits }) => inSubnet(value, network, bits));
}

export function isForbiddenEgressIpv6(address: string): boolean {
  // Zone identifiers carry no routing meaning here (WP05.2).
  const withoutZone = address.split('%')[0];
  if (withoutZone.toLowerCase().startsWith('::ffff:')) {
    const embedded = withoutZone.slice(7);
    return isIP(embedded) === 4 ? isForbiddenEgressIpv4(embedded) : true;
  }
  const value = ipv6ToBigInt(withoutZone);
  return FORBIDDEN_IPV6_RANGES.some(({ network, bits }) => inSubnet6(value, network, bits));
}

export function isForbiddenEgressIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isForbiddenEgressIpv4(address);
  if (version === 6) return isForbiddenEgressIpv6(address);
  return true; // Unparseable addresses are never allowed.
}

/** Every '%' must start a valid two-digit hex escape (WP05.1). */
function hasMalformedPercentEncoding(rawUrl: string): boolean {
  return /%(?![0-9a-fA-F]{2})/.test(rawUrl);
}

/** One canonical host form for checks, resolution and telemetry: lowercase,
 * bracket-free IPv6, no trailing dots (WP05.2). */
export function normalizeMcpDestinationHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.+)\]$/, '$1').replace(/\.+$/, '');
}

/** Synchronous URL-shape validation. Deterministic denials, no I/O. */
export function assertMcpDestinationUrl(serverUrl: string, options: McpDestinationPolicyOptions = {}): URL {
  const allowedPorts = options.allowedPorts ?? DEFAULT_PORTS;
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new McpDestinationPolicyError('invalid_url', '');
  }
  // WHATWG parsing canonicalizes alternative IPv4 spellings and IDN hosts.
  const host = normalizeMcpDestinationHost(parsed.hostname);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new McpDestinationPolicyError('unsupported_scheme', host);
  }
  if (parsed.username || parsed.password) {
    throw new McpDestinationPolicyError('embedded_credentials', host);
  }
  if (parsed.hash) {
    throw new McpDestinationPolicyError('fragment_present', host);
  }
  if (hasMalformedPercentEncoding(serverUrl)) {
    throw new McpDestinationPolicyError('malformed_percent_encoding', host);
  }
  if (parsed.protocol === 'http:' && !(options.allowInsecureHttp ?? false)) {
    throw new McpDestinationPolicyError('insecure_http', host);
  }
  if (!host || (!isIP(host) && !host.includes('.'))) {
    throw new McpDestinationPolicyError('missing_hostname', host);
  }
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : parsed.protocol === 'https:' ? 443 : 80;
  if (!allowedPorts.includes(port)) {
    throw new McpDestinationPolicyError('port_not_allowed', host);
  }
  return parsed;
}

/**
 * Full destination check: URL shape, then resolution of ALL A and AAAA
 * records with every address checked against the forbidden ranges. Resolves
 * with the validated address list or throws {@link McpDestinationPolicyError}.
 */
/** Shape checks that apply to EVERY destination, including exact configured
 * internal endpoints: parseability, http/https only, no userinfo, no
 * fragment, sane percent-encoding, hostname present. */
function parseAndAssertBasicShape(serverUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new McpDestinationPolicyError('invalid_url', '');
  }
  const host = normalizeMcpDestinationHost(parsed.hostname);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new McpDestinationPolicyError('unsupported_scheme', host);
  }
  if (parsed.username || parsed.password) {
    throw new McpDestinationPolicyError('embedded_credentials', host);
  }
  if (parsed.hash) {
    throw new McpDestinationPolicyError('fragment_present', host);
  }
  if (hasMalformedPercentEncoding(serverUrl)) {
    throw new McpDestinationPolicyError('malformed_percent_encoding', host);
  }
  if (!host) {
    throw new McpDestinationPolicyError('missing_hostname', host);
  }
  return parsed;
}

/** Canonical scheme://host:port/path form so URL spellings cannot differ from
 * an admin-configured endpoint. Null for anything unusable. */
export function canonicalMcpEndpoint(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.hash || parsed.search) return null;
  const host = normalizeMcpDestinationHost(parsed.hostname);
  if (!host) return null;
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  return `${parsed.protocol}//${host}:${port}${parsed.pathname.replace(/\/+$/, '')}`;
}

function matchesExactEndpoint(serverUrl: string, allowExactEndpoints?: string[]): boolean {
  const endpoints = (allowExactEndpoints ?? [])
    .map((entry) => canonicalMcpEndpoint(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (endpoints.length === 0) return false;
  const candidate = canonicalMcpEndpoint(serverUrl);
  return Boolean(candidate) && endpoints.includes(candidate as string);
}

export async function assertMcpDestinationAllowed(serverUrl: string, options: McpDestinationPolicyOptions = {}): Promise<string[]> {
  const parsed = parseAndAssertBasicShape(serverUrl);
  const host = normalizeMcpDestinationHost(parsed.hostname);

  // WP05.5: exact admin-configured internal service endpoints are a fixed
  // private-network rule reached with service-issued JWTs — they bypass the
  // public-destination rules (plain http, non-allowlisted ports, private DNS
  // ranges) but nothing else. Matching is canonical and exact, so lookalike
  // URLs inherit nothing.
  if (matchesExactEndpoint(serverUrl, options.allowExactEndpoints)) {
    return [];
  }

  if (parsed.protocol === 'http:' && !(options.allowInsecureHttp ?? false)) {
    throw new McpDestinationPolicyError('insecure_http', host);
  }
  const allowedPorts = options.allowedPorts ?? DEFAULT_PORTS;
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : parsed.protocol === 'https:' ? 443 : 80;
  if (!allowedPorts.includes(port)) {
    throw new McpDestinationPolicyError('port_not_allowed', host);
  }

  // Literal-IP destinations (any spelling WHATWG canonicalizes) never touch DNS.
  if (isIP(host)) {
    if (isForbiddenEgressIp(host)) {
      throw new McpDestinationPolicyError('forbidden_address', host);
    }
    return [host];
  }
  const resolver = options.resolver ?? DEFAULT_RESOLVER;
  const [ipv4, ipv6] = await Promise.all([
    resolver.resolve4(host).catch(() => [] as string[]),
    resolver.resolve6(host).catch(() => [] as string[]),
  ]);
  const addresses = [...ipv4, ...ipv6];
  if (addresses.length === 0) {
    throw new McpDestinationPolicyError('dns_failure', host);
  }
  const forbidden = addresses.find((address) => isForbiddenEgressIp(address));
  if (forbidden) {
    throw new McpDestinationPolicyError('forbidden_address', host);
  }
  return addresses;
}
