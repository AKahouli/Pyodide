import { lookup } from 'dns/promises';
import { BadRequestException } from '../../exceptions';

/**
 * SSRF guard for server-side fetches triggered by user-supplied URLs
 * (link reachability checks and the URL-to-PDF conversion). Rejects
 * anything that isn't a plain http(s) URL, and rejects any URL whose
 * hostname resolves (via DNS) to a private, loopback, link-local,
 * unspecified, or CGNAT address — this covers direct IP-literal SSRF
 * attempts as well as DNS-rebinding to internal hosts/cloud metadata
 * endpoints (e.g. 169.254.169.254).
 */
export async function assertUrlIsSafe(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('Only http(s) URLs are allowed');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Only http(s) URLs are allowed');
  }

  const hostname = parsed.hostname;
  if (hostname.toLowerCase() === 'localhost') {
    throw new BadRequestException(
      'URL resolves to a disallowed (private/internal) address',
    );
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BadRequestException('Unable to resolve host for the provided URL');
  }

  const hasDisallowedAddress = addresses.some(({ address, family }) =>
    family === 6 ? isPrivateIpv6Address(address) : isPrivateIpv4Address(address),
  );

  if (hasDisallowedAddress) {
    throw new BadRequestException(
      'URL resolves to a disallowed (private/internal) address',
    );
  }
}

/**
 * Parse an IPv4 dotted-quad string into its 32-bit integer form.
 * Returns null for anything that isn't a well-formed IPv4 address.
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

/** Whether `ip` falls within the CIDR block `base/prefixLen` (IPv4 only). */
function isIpv4InCidr(ip: string, base: string, prefixLen: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;

  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * Private/loopback/link-local/unspecified/CGNAT ranges for IPv4, including
 * the cloud metadata endpoint (169.254.169.254 falls under 169.254.0.0/16).
 */
export function isPrivateIpv4Address(ip: string): boolean {
  const disallowedRanges: Array<[string, number]> = [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local, includes cloud metadata IP
    ['0.0.0.0', 8], // "this network" / unspecified
    ['100.64.0.0', 10], // CGNAT
  ];
  return disallowedRanges.some(([base, prefixLen]) =>
    isIpv4InCidr(ip, base, prefixLen),
  );
}

/**
 * Extracts the first 16-bit group ("hextet") of an IPv6 address as an
 * integer, accounting for the leading `::` zero-compression form.
 */
function firstIpv6Hextet(address: string): number | null {
  if (address.startsWith('::')) return 0;
  const firstGroup = address.split(':')[0];
  if (!/^[0-9a-f]{1,4}$/i.test(firstGroup)) return null;
  return parseInt(firstGroup, 16);
}

/**
 * Private/loopback/link-local/unspecified ranges for IPv6, plus
 * IPv4-mapped (`::ffff:a.b.c.d`) addresses that encode a disallowed IPv4.
 */
export function isPrivateIpv6Address(ip: string): boolean {
  const address = ip.toLowerCase().split('%')[0]; // strip zone id, if any

  if (address === '::1' || address === '::') return true;

  const mappedIpv4 = address.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedIpv4) return isPrivateIpv4Address(mappedIpv4[1]);

  const firstHextet = firstIpv6Hextet(address);
  if (firstHextet === null) return false;

  const isUniqueLocal = firstHextet >= 0xfc00 && firstHextet <= 0xfdff; // fc00::/7
  const isLinkLocal = firstHextet >= 0xfe80 && firstHextet <= 0xfebf; // fe80::/10
  return isUniqueLocal || isLinkLocal;
}
