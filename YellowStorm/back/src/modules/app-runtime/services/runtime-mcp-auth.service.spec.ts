import { ConfigService } from '@nestjs/config';
import { AuthError } from '../mcp/runtime-mcp.errors';
import { RuntimeBindingService } from './runtime-binding.service';
import { RuntimeMcpAuthService } from './runtime-mcp-auth.service';
import { RuntimeTokenService } from './runtime-token.service';

describe('RuntimeMcpAuthService', () => {
  const findByMcpTokenHash = jest.fn();
  const hash = jest.fn((token: string) => `hash:${token}`);

  const bindings = { findByMcpTokenHash } as unknown as RuntimeBindingService;
  const tokens = { hash } as unknown as RuntimeTokenService;
  const svc = new RuntimeMcpAuthService(bindings, tokens);

  beforeEach(() => jest.clearAllMocks());

  it('extracts bearer tokens case-insensitively', () => {
    expect(svc.extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(svc.extractBearerToken('bearer xyz')).toBe('xyz');
  });

  it('rejects missing or malformed authorization', () => {
    expect(() => svc.extractBearerToken(undefined)).toThrow(AuthError);
    expect(() => svc.extractBearerToken('Basic abc')).toThrow(AuthError);
    expect(() => svc.extractBearerToken('Bearer   ')).toThrow(AuthError);
  });

  it('resolves a binding from the hashed bearer token', async () => {
    const binding = { bindingId: 'arb_1', workspaceId: 'sess_1' };
    findByMcpTokenHash.mockResolvedValueOnce(binding);

    const result = await svc.resolveBinding('Bearer live-token');

    expect(hash).toHaveBeenCalledWith('live-token');
    expect(findByMcpTokenHash).toHaveBeenCalledWith('hash:live-token');
    expect(result).toBe(binding);
  });

  it('rejects unknown tokens', async () => {
    findByMcpTokenHash.mockResolvedValueOnce(null);
    await expect(svc.resolveBinding('Bearer dead')).rejects.toThrow(AuthError);
  });
});
