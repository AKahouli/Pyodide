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

  it('mints a single-use token and returns a full-setup envelope', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-abc' });
    const env = await svc().mintSessionToken();

    const arg = createMock.mock.calls[0][0].config;
    expect(arg.uses).toBe(1);

    expect(env.wsUrl).toBe('wss://host/ws/Constrained?access_token=ephemeral-abc');
    // The backend authors the full setup: model + modalities + voice + prompt + tools.
    const setup = env.setup as any;
    expect(setup.model).toBe('models/gemini-live');
    expect(setup.responseModalities).toEqual(['AUDIO']);
    expect(setup.systemInstruction.parts[0].text).toContain('worky');
    expect(setup.tools[0].functionDeclarations).toHaveLength(2);
    expect(typeof env.expiresAt).toBe('string');
  });

  it('threads a resumption handle into the setup', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-xyz' });
    const env = await svc().mintSessionToken({ resumptionHandle: 'h-9' });
    expect((env.setup as any).sessionResumption.handle).toBe('h-9');
  });

  it('throws a clear error when the API key is unset', async () => {
    await expect(svc({ 'worky.voiceApiKey': '' }).mintSessionToken()).rejects.toThrow(/not configured/i);
    expect(createMock).not.toHaveBeenCalled();
  });
});
