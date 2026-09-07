import { WorkyVoiceController } from './worky-voice.controller';

describe('WorkyVoiceController', () => {
  const tokens = { mintSessionToken: jest.fn() };
  const tools = { dispatchTask: jest.fn(), queryStatus: jest.fn() };
  const planning = { appendVoiceMessage: jest.fn() };
  const ctrl = new WorkyVoiceController(tokens as any, tools as any, planning as any);
  const user = { _id: { toString: () => 'u1' } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('POST session returns the minted envelope', async () => {
    tokens.mintSessionToken.mockResolvedValue({ wsUrl: 'wss://x?access_token=t', setup: {}, expiresAt: 'z' });
    const res = await ctrl.createSession(user, { resumptionHandle: 'h1' });
    expect(tokens.mintSessionToken).toHaveBeenCalledWith({
      resumptionHandle: 'h1',
      prompt: undefined,
      requester: { name: undefined, email: undefined, role: undefined },
    });
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

  it('POST tool/transcript persists a voice turn', async () => {
    planning.appendVoiceMessage.mockResolvedValue({ id: 'm1' });
    const res = await ctrl.transcript(user, { streamId: 's1', role: 'manager', text: 'hi there' });
    expect(planning.appendVoiceMessage).toHaveBeenCalledWith('u1', 's1', 'manager', 'hi there');
    expect(res.id).toBe('m1');
  });

  it('POST session resolves the per-stream prompt and passes it to mint', async () => {
    (planning as any).getVoicePrompt = jest.fn().mockResolvedValue({ prompt: 'Persona Q' });
    tokens.mintSessionToken.mockResolvedValue({ wsUrl: 'wss://x', setup: {}, expiresAt: 'z' });
    await ctrl.createSession(user, { streamId: 's1', resumptionHandle: 'h1' });
    expect((planning as any).getVoicePrompt).toHaveBeenCalledWith('u1', 's1');
    expect(tokens.mintSessionToken).toHaveBeenCalledWith({
      resumptionHandle: 'h1',
      prompt: 'Persona Q',
      requester: { name: undefined, email: undefined, role: undefined },
    });
  });

  it('GET prompt returns default flag when unset', async () => {
    (planning as any).getVoicePrompt = jest.fn().mockResolvedValue({ prompt: null });
    const res = await ctrl.getPrompt(user, 's1');
    expect(res.isDefault).toBe(true);
    expect(res.prompt).toContain('worky');
  });

  it('PUT prompt saves and reports non-default', async () => {
    (planning as any).setVoicePrompt = jest.fn().mockResolvedValue({ prompt: 'Hi' });
    const res = await ctrl.setPrompt(user, 's1', { prompt: 'Hi' });
    expect((planning as any).setVoicePrompt).toHaveBeenCalledWith('u1', 's1', 'Hi');
    expect(res).toEqual({ prompt: 'Hi', isDefault: false });
  });
});
