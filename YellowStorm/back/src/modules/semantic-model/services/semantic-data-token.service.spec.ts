import { SemanticDataTokenService, signHs256 } from './semantic-data-token.service';

const decode = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

const serviceWith = (config: Record<string, unknown>, requireRole: jest.Mock) =>
  new SemanticDataTokenService(
    config as never,
    { requireRole } as never,
    { setContext: jest.fn() } as never,
  );

const baseConfig = {
  dataJwtSecret: 'data-secret',
  realtimeJwtSecret: 'realtime-secret',
  dataTokenTtlSeconds: 60,
  dataRestUrl: 'http://127.0.0.1:3000',
  dataRealtimeUrl: 'ws://127.0.0.1:4000',
};

describe('SemanticDataTokenService', () => {
  it('mints model-scoped tokens only after a membership check', async () => {
    const requireRole = jest.fn().mockResolvedValue({ role: 'viewer' });
    const issued = await serviceWith(baseConfig, requireRole).issue('user-1', 'model-9');
    expect(requireRole).toHaveBeenCalledWith('user-1', 'model-9', ['owner', 'editor', 'viewer']);
    expect(decode(issued.token)).toMatchObject({ sub: 'user-1', role: 'semantic_api_user', model_id: 'model-9', iss: 'yellowmind' });
    expect(decode(issued.realtimeToken)).toMatchObject({ sub: 'user-1', role: 'authenticated', model_id: 'model-9' });
    expect(issued.topic).toBe('semantic-model:model-9');
    const exp = decode(issued.token).exp as number;
    expect(Math.floor(new Date(issued.expiresAt).getTime() / 1000)).toBe(exp);
  });

  it('fails closed when data-plane secrets are unconfigured', async () => {
    const requireRole = jest.fn().mockResolvedValue({ role: 'viewer' });
    await expect(
      serviceWith({ ...baseConfig, dataJwtSecret: '' }, requireRole).issue('user-1', 'model-9'),
    ).rejects.toThrow('not configured');
  });

  it('propagates non-member rejection without minting', async () => {
    const requireRole = jest.fn().mockRejectedValue(new Error('not a member'));
    await expect(serviceWith(baseConfig, requireRole).issue('user-2', 'model-9')).rejects.toThrow('not a member');
  });

  it('signs verifiable HS256 tokens', () => {
    const token = signHs256('s', { sub: 'u' });
    expect(token.split('.')).toHaveLength(3);
    expect(decode(token)).toMatchObject({ sub: 'u' });
  });
});
