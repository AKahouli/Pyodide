import { WorkyVoiceController } from './worky-voice.controller';

describe('WorkyVoiceController', () => {
  const tokens = { mintSessionToken: jest.fn() };
  const tools = { dispatchTask: jest.fn(), queryStatus: jest.fn() };
  const ctrl = new WorkyVoiceController(tokens as any, tools as any);
  const user = { _id: { toString: () => 'u1' } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('POST session returns the minted envelope', async () => {
    tokens.mintSessionToken.mockResolvedValue({ wsUrl: 'wss://x?access_token=t', setup: {}, expiresAt: 'z' });
    const res = await ctrl.createSession(user, { resumptionHandle: 'h1' });
    expect(tokens.mintSessionToken).toHaveBeenCalledWith({ resumptionHandle: 'h1' });
    expect(res.wsUrl).toContain('access_token=t');
  });

  it('POST tool/dispatch forwards to VoiceToolService with the caller user id', async () => {
    tools.dispatchTask.mockResolvedValue({ runId: 'r', sessionId: 's', accepted: true });
    const res = await ctrl.dispatch(user, { streamId: 's1', message: 'go' });
    expect(tools.dispatchTask).toHaveBeenCalledWith('u1', 's1', 'go');
    expect(res.accepted).toBe(true);
  });

  it('POST tool/status forwards to VoiceToolService', async () => {
    tools.queryStatus.mockResolvedValue({ status: 'running', title: 'T', plan: {} });
    const res = await ctrl.status(user, { streamId: 's1' });
    expect(tools.queryStatus).toHaveBeenCalledWith('u1', 's1');
    expect(res.status).toBe('running');
  });
});
