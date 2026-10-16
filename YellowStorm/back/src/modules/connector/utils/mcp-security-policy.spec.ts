import { BadRequestException, ForbiddenException } from '@modules/exceptions';
import { Permissions } from '@modules/authorization/constants/permissions';
import { assertMcpSecurityManager, assertNoReservedMcpOverrides, canonicalMcpEndpoint,
  hasConfiguredMcpCredential, hasMcpCredentialHeaders, mcpBindingChanged, normalizeMcpSecurityPolicy } from './mcp-security-policy';

describe('MCP security policy validation', () => {
  const configured = { version: 1, profile: 'configured', actorDelegation: 'none', allowPrivateNetwork: false, requiredPermissions: [] };
  it.each<Record<string, string>>([{}, { 'X-User-Id': 'user', 'X-Correlation-ID': 'trace' }, { Authorization: 'Bearer ' }, { Authorization: '' }])
  ('does not count missing credentials or trace headers as authentication (%j)', headers => {
    expect(hasMcpCredentialHeaders(headers)).toBe(false);
    expect(hasConfiguredMcpCredential({ authSourceType: 'connected_app', mcpServerConfig: { headers: { Authorization: 'Bearer static-fallback' } } }, headers)).toBe(false);
  });
  it('accepts literal saved custom credentials only outside connected-account fallback', () => {
    expect(hasConfiguredMcpCredential({ authSourceType: 'none', mcpServerConfig: { headers: { Authorization: 'Bearer saved' } } }, {})).toBe(true);
    expect(hasConfiguredMcpCredential({ authSourceType: 'connected_app' }, { Authorization: 'Bearer resolved-account' })).toBe(true);
    expect(hasConfiguredMcpCredential({ authSourceType: 'none' }, {})).toBe(false);
  });

  it('defaults safely without sharing mutable permission arrays', () => {
    const first = normalizeMcpSecurityPolicy(undefined);
    first.requiredPermissions.push(Permissions.CONNECTORS_READ);
    expect(normalizeMcpSecurityPolicy(undefined)).toEqual(configured);
  });

  it.each([
    null, [], 'public', { ...configured, version: '1' }, { ...configured, allowPrivateNetwork: 'false' },
    { ...configured, profile: ['configured'] }, { ...configured, actorDelegation: ['none'] },
    { ...configured, requiredPermissions: ['invented.permission'] }, { ...configured, requiredPermissions: {} },
    { ...configured, requiredPermissions: Array(101).fill(Permissions.CONNECTORS_READ) },
    { ...configured, audience: 'unexpected' }, { ...configured, actorDelegation: 'verified_user' },
    { ...configured, profile: 'public', allowPrivateNetwork: true },
    { ...configured, profile: 'internal_jwt', audience: '' },
    { ...configured, profile: 'internal_jwt', audience: { toString: (): string => 'recipient' } },
    { ...configured, profile: 'internal_jwt', audience: 'bad audience' },
    { ...configured, unrecognizedGrant: true },
  ])('rejects malformed, coercible or unknown policy data (%j)', value => {
    expect(() => normalizeMcpSecurityPolicy(value)).toThrow(BadRequestException);
  });

  it('normalizes explicit internal audience and known permissions deterministically', () => {
    expect(normalizeMcpSecurityPolicy({ ...configured, profile: 'internal_jwt', audience: ' recipient ',
      actorDelegation: 'verified_user', requiredPermissions: [Permissions.CONNECTORS_READ, Permissions.CONNECTORS_READ] }))
      .toEqual({ ...configured, profile: 'internal_jwt', audience: 'recipient', actorDelegation: 'verified_user', requiredPermissions: [Permissions.CONNECTORS_READ] });
  });

  it('requires security management rather than ordinary editing authority', () => {
    expect(() => assertMcpSecurityManager([Permissions.CONNECTORS_UPDATE])).toThrow(ForbiddenException);
    expect(() => assertMcpSecurityManager([Permissions.CONNECTORS_SECURITY_MANAGE])).not.toThrow();
    expect(() => assertMcpSecurityManager(['connectors.*'])).not.toThrow();
  });

  it.each(['X-YellowStorm-User-Id', 'x-yellowstorm-service-token', 'X-YellowStorm-Mcp-Assertion',
    'YELLOWSTORM_MCP_JWT_USER_ID', 'ADK_RUNTIME_MCP_RENEWAL_TOKEN', 'INTERNAL_SERVICE_SECRET'])
  ('rejects nested reserved authority key %s', key => {
    expect(() => assertNoReservedMcpOverrides({ nested: [{ [key]: 'spoofed' }] })).toThrow(BadRequestException);
  });

  it('permits provider credentials without treating them as platform identity', () => {
    expect(() => assertNoReservedMcpOverrides({ headers: { Authorization: 'Bearer provider' } })).not.toThrow();
  });

  it('distinguishes omitted metadata from binding and revocation mutations', () => {
    expect(mcpBindingChanged({ mcpServerUrl: 'https://example.com/mcp' }, { name: 'new' })).toBe(false);
    expect(mcpBindingChanged({ mcpServerUrl: 'https://example.com/mcp' }, { mcpServerUrl: undefined })).toBe(false);
    expect(mcpBindingChanged({ isActive: true }, { isActive: false })).toBe(true);
    expect(mcpBindingChanged({ mcpServerConfig: { a: 1 } }, { mcpServerConfig: { a: 1 } })).toBe(false);
  });

  it('canonicalizes origin but preserves case-sensitive endpoint paths', () => {
    expect(canonicalMcpEndpoint('https://EXAMPLE.com:443/Mcp')).toBe('https://example.com:443/Mcp');
    expect(canonicalMcpEndpoint('https://example.com/Mcp')).not.toBe(canonicalMcpEndpoint('https://example.com/mcp'));
    expect(() => canonicalMcpEndpoint(' https://example.com/mcp')).toThrow(BadRequestException);
  });
});
