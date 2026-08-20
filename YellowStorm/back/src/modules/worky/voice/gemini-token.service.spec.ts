import { GeminiTokenService } from './gemini-token.service';

const createMock = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    authTokens: { create: createMock },
  })),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING' },
}));

const CONNECTOR_ACTIONS = [
  {
    key: 'dispatch_task',
    description: 'Start a worky task.',
    parameterSchema: {
      type: 'object',
      properties: { message: { type: 'string' }, streamId: { type: 'string' } },
      required: ['message'],
    },
  },
  {
    key: 'get_task_details',
    description: 'Detail one task.',
    parameterSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, streamId: { type: 'string' } },
      required: ['taskId'],
    },
  },
];

function svc(overrides: Record<string, unknown> = {}, actions: unknown[] | null = CONNECTOR_ACTIONS) {
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
  // The concierge tools come from the connectors' actions; here only
  // 'worky-concierge' resolves (human-agents returns null and is skipped).
  const connectors = {
    findBySlug: jest.fn().mockImplementation((slug: string) =>
      slug === 'worky-concierge' && actions
        ? { slug, id: 'c1', mcpServerUrl: 'http://localhost:8080/mcp', actions }
        : null,
    ),
  } as any;
  return new GeminiTokenService(config, connectors);
}

describe('GeminiTokenService', () => {
  beforeEach(() => createMock.mockReset());

  it('mints a single-use token and returns a full-setup envelope', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-abc' });
    const env = await svc().mintSessionToken();

    const arg = createMock.mock.calls[0][0].config;
    expect(arg.uses).toBe(1);

    expect(env.wsUrl).toBe('wss://host/ws/Constrained?access_token=ephemeral-abc');
    // The backend authors the full setup in raw-proto shape: responseModalities
    // and speechConfig live under generationConfig, not at the top level.
    const setup = env.setup as any;
    expect(setup.model).toBe('models/gemini-live');
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
    expect(setup.systemInstruction.parts[0].text).toContain('worky');
    expect(setup.tools[0].functionDeclarations).toHaveLength(2);
    // Each tool is routed to its connector's MCP url (browser-reachable).
    expect(env.toolEndpoints).toEqual({
      dispatch_task: 'http://localhost:8080/mcp',
      get_task_details: 'http://localhost:8080/mcp',
    });
    // Both test actions declare streamId, so both need it injected.
    expect(env.streamIdTools.sort()).toEqual(['dispatch_task', 'get_task_details']);
    expect(typeof env.expiresAt).toBe('string');
  });

  it('threads a resumption handle into the setup', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-xyz' });
    const env = await svc().mintSessionToken({ resumptionHandle: 'h-9' });
    expect((env.setup as any).sessionResumption.handle).toBe('h-9');
  });

  it('threads a per-stream prompt into the setup', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-p' });
    const env = await svc().mintSessionToken({ prompt: 'Persona Z' });
    expect((env.setup as any).systemInstruction.parts[0].text).toBe('Persona Z');
  });

  it('throws a clear error when the API key is unset', async () => {
    await expect(svc({ 'worky.voiceApiKey': '' }).mintSessionToken()).rejects.toThrow(/not configured/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('throws a clear error when the concierge connector has no tools', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-none' });
    await expect(svc({}, null).mintSessionToken()).rejects.toThrow(/worky-concierge/);
  });
});
