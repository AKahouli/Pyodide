import {
  assertMcpDestinationAllowed,
  assertMcpDestinationUrl,
  isForbiddenEgressIp,
  isForbiddenEgressIpv4,
  isForbiddenEgressIpv6,
  McpDestinationPolicyError,
} from './mcp-destination-policy.util';

type FakeResolver = { resolve4: jest.Mock; resolve6: jest.Mock };

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
});
