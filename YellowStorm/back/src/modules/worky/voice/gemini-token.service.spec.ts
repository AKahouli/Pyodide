import { GeminiTokenService } from './gemini-token.service';

const createMock = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    authTokens: { create: createMock },
  })),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING' },
}));

function svc(overrides: Record<string, unknown> = {}) {
  const cfg = {
    'worky.voiceApiKey': 'test-key',
    'worky.voiceModel': 'gemini-live',
    'worky.voiceName': 'Kore',
    'worky.voiceWsBaseUrl': 'wss://host/ws/Constrained',
    'worky.voiceTokenTtlSec': 1800,
    'worky.voiceSessionStartTtlSec': 60,
    ...overrides,
  } as Record<string, unknown>;
  const config = { get: <T>(k: string) => cfg[k] as T } as any;
  return new GeminiTokenService(config);
}

describe('GeminiTokenService', () => {
  beforeEach(() => createMock.mockReset());

  it('mints a single-use constrained token and returns an opaque envelope', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-abc' });
    const env = await svc().mintSessionToken();

    const arg = createMock.mock.calls[0][0].config;
    expect(arg.uses).toBe(1);
    expect(arg.liveConnectConstraints.model).toBe('models/gemini-live');
    expect(arg.liveConnectConstraints.config.tools[0].functionDeclarations).toHaveLength(2);

    expect(env.wsUrl).toBe('wss://host/ws/Constrained?access_token=ephemeral-abc');
    // The client relays only the model in the setup; the rest is locked in the token.
    expect(env.setup).toEqual({ model: 'models/gemini-live' });
    expect(typeof env.expiresAt).toBe('string');
  });

  it('threads a resumption handle into the bound config', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-xyz' });
    await svc().mintSessionToken({ resumptionHandle: 'h-9' });
    const arg = createMock.mock.calls[0][0].config;
    expect(arg.liveConnectConstraints.config.sessionResumption.handle).toBe('h-9');
  });

  it('throws a clear error when the API key is unset', async () => {
    await expect(svc({ 'worky.voiceApiKey': '' }).mintSessionToken()).rejects.toThrow(/not configured/i);
    expect(createMock).not.toHaveBeenCalled();
  });
});
