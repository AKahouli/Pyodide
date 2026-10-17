import * as dns from 'dns/promises';
import {
  assertMcpDestinationAllowed,
  assertMcpDestinationUrl,
  isForbiddenEgressIp,
  isForbiddenEgressIpv4,
  isForbiddenEgressIpv6,
  McpDestinationPolicyError,
} from './mcp-destination-policy.util';

type FakeResolver = { resolve4: jest.Mock; resolve6: jest.Mock };

jest.mock('dns/promises', () => ({
  ...jest.requireActual('dns/promises'),
  lookup: jest.fn(),
}));
const lookupMock = dns.lookup as jest.Mock;

const fakeResolver = (ipv4: string[] | Error, ipv6: string[] | Error = []): FakeResolver => ({
  resolve4: jest.fn().mockImplementation((host: string) =>
    ipv4 instanceof Error ? Promise.reject(ipv4) : Promise.resolve(ipv4)),
  resolve6: jest.fn().mockImplementation((host: string) =>
    ipv6 instanceof Error ? Promise.reject(ipv6) : Promise.resolve(ipv6)),
});

describe('McpDestinationPolicy IP range classification (WP05.2)', () => {
  const forbiddenV4 = [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255',
    '127.0.0.1', '127.8.8.8', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '192.0.0.1', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.19.255.255',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '168.63.129.16',
  ];
  const allowedV4 = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '100.128.0.1', '198.20.0.1', '9.9.9.9'];

  it.each(forbiddenV4)('classifies IPv4 %s as forbidden', (address) => {
    expect(isForbiddenEgressIpv4(address)).toBe(true);
  });

  it.each(allowedV4)('classifies IPv4 %s as allowed', (address) => {
    expect(isForbiddenEgressIpv4(address)).toBe(false);
  });

  it.each([
    '::', '::1', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'fd00:ec2::254',
    'ff02::1', '2001:db8::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:169.254.169.254',
    '0:0:0:0:0:0:0:1',
  ])('classifies IPv6 %s as forbidden', (address) => {
    expect(isForbiddenEgressIpv6(address)).toBe(true);
  });

  it.each(['2606:4700::1111', '2620:fe::fe', '::ffff:8.8.8.8'])('classifies IPv6 %s as allowed', (address) => {
    expect(isForbiddenEgressIpv6(address)).toBe(false);
  });

  it('treats unparseable addresses as forbidden and accepts zone identifiers on check', () => {
    expect(isForbiddenEgressIp('not-an-ip')).toBe(true);
    expect(isForbiddenEgressIp('fe80::1%eth0')).toBe(true);
  });
});

describe('McpDestinationPolicy URL-shape validation (WP05.1)', () => {
  it('accepts a well-formed https URL', () => {
    expect(assertMcpDestinationUrl('https://mcp.example.test/mcp').hostname).toBe('mcp.example.test');
  });

  it.each([
    ['ftp://mcp.example.test', 'unsupported_scheme'],
    ['file:///etc/passwd', 'unsupported_scheme'],
    ['gopher://mcp.example.test', 'unsupported_scheme'],
    ['https://user:pass@mcp.example.test/mcp', 'embedded_credentials'],
    ['https://token@mcp.example.test/mcp', 'embedded_credentials'],
    ['https://mcp.example.test/mcp#fragment', 'fragment_present'],
    ['https://mcp.example.test/%zzpath', 'malformed_percent_encoding'],
    ['https://mcp.example.test:9443/mcp', 'port_not_allowed'],
    ['http://mcp.example.test/mcp', 'insecure_http'],
    ['https:///no-host', 'missing_hostname'],
  ])('rejects %s with reason %s', (url, reason) => {
    expect(() => assertMcpDestinationUrl(url)).toThrow(McpDestinationPolicyError);
    try {
      assertMcpDestinationUrl(url);
    } catch (error) {
      expect((error as McpDestinationPolicyError).reason).toBe(reason);
    }
  });

  it('rejects unparseable URLs', () => {
    expect(() => assertMcpDestinationUrl('not a url at all')).toThrow(McpDestinationPolicyError);
  });

  it('allows plain http only with the explicit development opt-in', () => {
    expect(assertMcpDestinationUrl('http://mcp.example.test/mcp', { allowInsecureHttp: true }).protocol).toBe('http:');
  });

  it('honors a custom allowed-port list', () => {
    expect(assertMcpDestinationUrl('https://mcp.example.test:9443/mcp', { allowedPorts: [9443] }).port).toBe('9443');
  });

  it('normalizes alternative IPv4 spellings, trailing dots and IDN to canonical hosts', () => {
    // WHATWG canonicalization: decimal IPv4 → dotted, IDN → punycode.
    expect(assertMcpDestinationUrl('https://2130706433/mcp').hostname).toBe('127.0.0.1');
    expect(assertMcpDestinationUrl('https://mcp.example.test./mcp').hostname).toBe('mcp.example.test.');
    expect(assertMcpDestinationUrl('https://ünicode.test/mcp').hostname).toBe('xn--nicode-2ya.test');
  });
});

describe('McpDestinationPolicy default OS resolution', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    jest.spyOn(dns.Resolver.prototype, 'resolve4').mockRejectedValue(new Error('ECONNREFUSED'));
    jest.spyOn(dns.Resolver.prototype, 'resolve6').mockRejectedValue(new Error('ECONNREFUSED'));
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('uses every OS lookup address without requiring direct DNS queries', async () => {
    await expect(assertMcpDestinationAllowed('https://mcp.example.test/mcp'))
      .resolves.toEqual(['93.184.216.34', '2606:4700::1111']);
    expect(dns.lookup).toHaveBeenCalledWith('mcp.example.test', { all: true });
    expect(dns.Resolver.prototype.resolve4).not.toHaveBeenCalled();
    expect(dns.Resolver.prototype.resolve6).not.toHaveBeenCalled();
  });

  it.each(['10.0.0.1', '169.254.169.254', 'fd00:ec2::254', 'fe80::1', 'not-an-ip'])(
    'rejects mixed public and forbidden OS records containing %s', async address => {
      lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }]);
      await expect(assertMcpDestinationAllowed('https://mcp.example.test/mcp'))
        .rejects.toMatchObject({ reason: 'forbidden_address' });
      expect(dns.Resolver.prototype.resolve4).not.toHaveBeenCalled();
    },
  );

  it.each(['169.254.169.254', '168.63.129.16', '0.0.0.0', '224.0.0.1', 'fd00:ec2::254', 'fe80::1', 'not-an-ip'])(
    'does not grant exact private endpoints access to OS record %s', async address => {
      const endpoint = 'https://mcp.internal.example/mcp';
      lookupMock.mockResolvedValue([{ address: '10.0.0.1', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }]);
      await expect(assertMcpDestinationAllowed(endpoint, { allowExactEndpoints: [endpoint] }))
        .rejects.toMatchObject({ reason: 'forbidden_address' });
    },
  );

  it('rejects OS lookup failure without falling back to direct DNS', async () => {
    lookupMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(assertMcpDestinationAllowed('https://mcp.example.test/mcp'))
      .rejects.toMatchObject({ reason: 'dns_failure' });
    expect(dns.Resolver.prototype.resolve4).not.toHaveBeenCalled();
    expect(dns.Resolver.prototype.resolve6).not.toHaveBeenCalled();
  });

  it('rejects an empty OS lookup result', async () => {
    lookupMock.mockResolvedValue([]);
    await expect(assertMcpDestinationAllowed('https://mcp.example.test/mcp'))
      .rejects.toMatchObject({ reason: 'dns_failure' });
  });

  it('bounds OS lookup wait and ignores late completion', async () => {
    jest.useFakeTimers();
    let complete!: (records: { address: string; family: number }[]) => void;
    lookupMock.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const check = expect(assertMcpDestinationAllowed('https://mcp.example.test/mcp'))
      .rejects.toMatchObject({ reason: 'dns_failure' });
    await jest.advanceTimersByTimeAsync(6000);
    await check;
    expect(jest.getTimerCount()).toBe(0);
    complete([{ address: '93.184.216.34', family: 4 }]);
    await Promise.resolve();
  });

  it.each([false, true])('cleans up the timeout after OS lookup settles (failure=%s)', async failure => {
    jest.useFakeTimers();
    if (failure) lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    const result = assertMcpDestinationAllowed('https://mcp.example.test/mcp');
    if (failure) await expect(result).rejects.toMatchObject({ reason: 'dns_failure' });
    else await expect(result).resolves.toEqual(['93.184.216.34', '2606:4700::1111']);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not grant localhost authority unless the endpoint is exactly approved', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]);
    await expect(assertMcpDestinationAllowed('https://localhost/mcp'))
      .rejects.toMatchObject({ reason: 'forbidden_address' });
    const endpoint = 'http://localhost:8027/mcp';
    await expect(assertMcpDestinationAllowed(endpoint, { allowExactEndpoints: [endpoint] }))
      .resolves.toEqual(['127.0.0.1', '::1']);
    lookupMock.mockClear();
    await expect(assertMcpDestinationAllowed(endpoint, { allowExactEndpoints: [endpoint], requireTls: true }))
      .rejects.toMatchObject({ reason: 'insecure_http' });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('never looks up literal public or approved private IPs', async () => {
    await expect(assertMcpDestinationAllowed('https://8.8.8.8/mcp')).resolves.toEqual(['8.8.8.8']);
    const endpoint = 'http://127.0.0.1:8027/mcp';
    await expect(assertMcpDestinationAllowed(endpoint, { allowExactEndpoints: [endpoint] }))
      .resolves.toEqual(['127.0.0.1']);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe('McpDestinationPolicy destination checks (WP05.2/WP05.3)', () => {
  it('resolves and allows a public destination across all A and AAAA records', async () => {
    const resolver = fakeResolver(['93.184.216.34', '93.184.216.35'], ['2606:2800:220:1:248:1893:25c8:1946']);

    const addresses = await assertMcpDestinationAllowed('https://mcp.example.test/mcp', { resolver });

    expect(addresses).toEqual(['93.184.216.34', '93.184.216.35', '2606:2800:220:1:248:1893:25c8:1946']);
    expect(resolver.resolve4).toHaveBeenCalledWith('mcp.example.test');
    expect(resolver.resolve6).toHaveBeenCalledWith('mcp.example.test');
  });

  it('denies when ANY resolved record is in a forbidden range', async () => {
    const resolver = fakeResolver(['93.184.216.34', '10.0.0.5']);

    await expect(assertMcpDestinationAllowed('https://mcp.example.test/mcp', { resolver }))
      .rejects.toMatchObject({ reason: 'forbidden_address', host: 'mcp.example.test' });
  });

  it('denies a destination whose IPv6 record points at the AWS metadata endpoint', async () => {
    const resolver = fakeResolver(['93.184.216.34'], ['fd00:ec2::254']);

    await expect(assertMcpDestinationAllowed('https://mcp.example.test/mcp', { resolver }))
      .rejects.toMatchObject({ reason: 'forbidden_address' });
  });

  it('denies literal forbidden IPs without DNS and allows literal public IPs', async () => {
    const resolver = fakeResolver(['8.8.8.8']);

    await expect(assertMcpDestinationAllowed('https://169.254.169.254/latest/meta-data', { resolver }))
      .rejects.toMatchObject({ reason: 'forbidden_address', host: '169.254.169.254' });
    expect(resolver.resolve4).not.toHaveBeenCalled();

    await expect(assertMcpDestinationAllowed('https://8.8.8.8/mcp', { resolver })).resolves.toEqual(['8.8.8.8']);
  });

  it('denies an IPv6 literal destination in a forbidden range', async () => {
    await expect(assertMcpDestinationAllowed('https://[fd12:3456::1]/mcp'))
      .rejects.toMatchObject({ reason: 'forbidden_address' });
  });

  it('denies when the hostname does not resolve', async () => {
    const resolver = fakeResolver(new Error('getaddrinfo ENOTFOUND mcp.example.test'), new Error('getaddrinfo ENOTFOUND mcp.example.test'));

    await expect(assertMcpDestinationAllowed('https://mcp.example.test/mcp', { resolver }))
      .rejects.toMatchObject({ reason: 'dns_failure' });
  });

  it('denies when resolution returns no usable addresses', async () => {
    const resolver = fakeResolver([], []);

    await expect(assertMcpDestinationAllowed('https://mcp.example.test/mcp', { resolver }))
      .rejects.toMatchObject({ reason: 'dns_failure' });
  });

  it('strips trailing dots before resolution so one normalized host is used everywhere', async () => {
    const resolver = fakeResolver(['93.184.216.34']);

    await assertMcpDestinationAllowed('https://mcp.example.test./mcp', { resolver });

    expect(resolver.resolve4).toHaveBeenCalledWith('mcp.example.test');
  });

  it('never reaches DNS for URLs that already fail shape validation', async () => {
    const resolver = fakeResolver(['93.184.216.34']);

    await expect(assertMcpDestinationAllowed('https://user:pass@mcp.example.test/mcp', { resolver }))
      .rejects.toMatchObject({ reason: 'embedded_credentials' });
    expect(resolver.resolve4).not.toHaveBeenCalled();
  });

  describe('exact admin-configured internal endpoints (WP05.5)', () => {
    const exact = ['http://localhost:8027/mcp', 'https://mcp.internal.example/mcp'];

    it('allows an exact configured internal endpoint despite loopback, plain http and a non-allowlisted port', async () => {
      const resolver = fakeResolver(['127.0.0.1']);

      await expect(assertMcpDestinationAllowed('http://localhost:8027/mcp', { allowExactEndpoints: exact, resolver }))
        .resolves.toEqual(['127.0.0.1']);
      expect(resolver.resolve4).toHaveBeenCalledWith('localhost');
    });

    it('canonicalizes spellings so case, trailing slash and explicit default port still match', async () => {
      const resolver = fakeResolver(['10.0.0.10']);
      await expect(assertMcpDestinationAllowed('HTTP://LOCALHOST:8027/mcp/', { allowExactEndpoints: exact, resolver }))
        .resolves.toEqual(['10.0.0.10']);
      await expect(assertMcpDestinationAllowed('https://mcp.internal.example:443/mcp', { allowExactEndpoints: exact, resolver }))
        .resolves.toEqual(['10.0.0.10']);
    });

    it.each(['169.254.169.254', '168.63.129.16', '0.0.0.0', '224.0.0.1', 'fd00:ec2::254', 'fe80::1'])('never grants metadata/link-local/reserved access to %s', async address => {
      const resolver = fakeResolver(address.includes(':') ? [] : [address], address.includes(':') ? [address] : []);
      await expect(assertMcpDestinationAllowed(exact[1], { allowExactEndpoints: exact, resolver }))
        .rejects.toMatchObject({ reason: 'forbidden_address' });
    });

    it('requires TLS in production even for an exact private endpoint', async () => {
      await expect(assertMcpDestinationAllowed(exact[0], { allowExactEndpoints: exact, requireTls: true }))
        .rejects.toMatchObject({ reason: 'insecure_http' });
    });

    it.each([
      ['http://localhost:8027/other', 'different path'],
      ['http://localhost:9999/mcp', 'different port'],
      ['http://localhost.evil.test:8027/mcp', 'lookalike host'],
      ['http://localhost:8027/mcp/extra/deeper', 'extended path'],
      ['https://localhost:8027/mcp?other=1', 'query appended'],
    ])('denies the lookalike %s (%s)', async (url) => {
      const resolver = fakeResolver(new Error('ENOTFOUND'), new Error('ENOTFOUND'));

      await expect(assertMcpDestinationAllowed(url, { allowExactEndpoints: exact, resolver }))
        .rejects.toBeInstanceOf(McpDestinationPolicyError);
    });

    it('still rejects configured endpoints that carry userinfo or a fragment', async () => {
      await expect(assertMcpDestinationAllowed('http://user:pass@localhost:8027/mcp', { allowExactEndpoints: exact }))
        .rejects.toMatchObject({ reason: 'embedded_credentials' });
      await expect(assertMcpDestinationAllowed('http://localhost:8027/mcp#frag', { allowExactEndpoints: exact }))
        .rejects.toMatchObject({ reason: 'fragment_present' });
    });
  });
});
