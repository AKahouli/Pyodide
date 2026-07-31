import { getClientIp, parseTrustProxySetting } from './client-ip';

describe('getClientIp', () => {
  it('uses Express-resolved request.ip', () => {
    expect(
      getClientIp({
        ip: '203.0.113.10',
        headers: { 'x-forwarded-for': '198.51.100.1' },
        socket: { remoteAddress: '10.0.0.1' },
      } as never),
    ).toBe('203.0.113.10');
  });

  it('ignores attacker-controlled forwarding headers when request.ip is unset', () => {
    expect(
      getClientIp({
        headers: {
          'x-forwarded-for': '198.51.100.1, 10.0.0.1',
          'x-real-ip': '198.51.100.2',
        },
        socket: { remoteAddress: '192.0.2.55' },
      } as never),
    ).toBe('192.0.2.55');
  });

  it('falls back to unknown when no address is available', () => {
    expect(getClientIp({ headers: {}, socket: {} } as never)).toBe('unknown');
  });
});

describe('parseTrustProxySetting', () => {
  it('defaults to false (do not trust forwarding headers)', () => {
    expect(parseTrustProxySetting(undefined)).toBe(false);
    expect(parseTrustProxySetting('')).toBe(false);
    expect(parseTrustProxySetting('false')).toBe(false);
    expect(parseTrustProxySetting('0')).toBe(false);
  });

  it('parses hop count, boolean true, and CIDR lists', () => {
    expect(parseTrustProxySetting('1')).toBe(1);
    expect(parseTrustProxySetting('true')).toBe(true);
    expect(parseTrustProxySetting('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustProxySetting('loopback,10.0.0.0/8')).toEqual([
      'loopback',
      '10.0.0.0/8',
    ]);
  });
});
