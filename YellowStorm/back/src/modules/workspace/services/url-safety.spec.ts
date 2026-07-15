import { assertUrlIsSafe, isPrivateIpv4Address, isPrivateIpv6Address } from './url-safety';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
import { lookup } from 'dns/promises';
const mockLookup = lookup as jest.MockedFunction<typeof lookup>;

describe('url-safety', () => {
  beforeEach(() => mockLookup.mockReset());

  it('flags private IPv4 ranges', () => {
    ['10.0.0.1', '172.16.5.4', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']
      .forEach((ip) => expect(isPrivateIpv4Address(ip)).toBe(true));
    ['8.8.8.8', '1.1.1.1', '93.184.216.34'].forEach((ip) => expect(isPrivateIpv4Address(ip)).toBe(false));
  });

  it('flags private IPv6 ranges', () => {
    ['::1', '::', 'fc00::1', 'fd12::3', 'fe80::1', '::ffff:127.0.0.1']
      .forEach((ip) => expect(isPrivateIpv6Address(ip)).toBe(true));
    ['2606:4700:4700::1111'].forEach((ip) => expect(isPrivateIpv6Address(ip)).toBe(false));
  });

  it('rejects non-http(s) and localhost', async () => {
    await expect(assertUrlIsSafe('ftp://x.com')).rejects.toThrow();
    await expect(assertUrlIsSafe('http://localhost/x')).rejects.toThrow();
    await expect(assertUrlIsSafe('not a url')).rejects.toThrow();
  });

  it('rejects a host resolving to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as any);
    await expect(assertUrlIsSafe('http://evil.test/')).rejects.toThrow(/disallowed/i);
  });

  it('allows a host resolving to a public address', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    await expect(assertUrlIsSafe('https://example.com/')).resolves.toBeUndefined();
  });
});
