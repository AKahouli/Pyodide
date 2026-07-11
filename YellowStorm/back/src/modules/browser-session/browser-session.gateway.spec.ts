import { BrowserSessionGateway } from './browser-session.gateway';

function fakeClient(userId?: string) {
  const emitted: Array<{ e: string; p: unknown }> = [];
  return {
    id: 'sock1',
    data: { userId } as { userId?: string; sessionId?: string },
    handshake: { auth: { token: userId ? 'tok' : undefined }, headers: {} },
    emit: (e: string, p: unknown) => emitted.push({ e, p }),
    disconnect: jest.fn(),
    emitted,
  };
}

describe('BrowserSessionGateway', () => {
  let svc: { create: jest.Mock; dispatchInput: jest.Mock; navigate: jest.Mock; destroy: jest.Mock };
  let gw: BrowserSessionGateway;

  beforeEach(() => {
    svc = {
      create: jest.fn().mockResolvedValue('sess1'),
      dispatchInput: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) };
    const config = { get: jest.fn() };
    const logger = { setContext: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    gw = new BrowserSessionGateway(svc as never, jwt as never, config as never, logger as never);
  });

  it('creates a session on start and returns the id', async () => {
    const client = fakeClient('u1');
    const ack = await gw.handleStart(client as never, { url: 'https://ok.example' });
    expect(svc.create).toHaveBeenCalledWith('u1', 'https://ok.example', expect.any(Function));
    expect(ack).toEqual({ ok: true, sessionId: 'sess1' });
    expect(client.data.sessionId).toBe('sess1');
  });

  it('returns busy when the service is over capacity', async () => {
    svc.create.mockRejectedValue(new Error('BUSY'));
    const client = fakeClient('u1');
    const ack = await gw.handleStart(client as never, { url: 'https://ok.example' });
    expect(ack).toEqual({ ok: false, error: 'BUSY' });
  });

  it('forwards input to the bound session', async () => {
    const client = fakeClient('u1');
    await gw.handleStart(client as never, { url: 'https://ok.example' });
    await gw.handleInput(client as never, { event: { kind: 'mouse', type: 'down', x: 5, y: 6 } });
    expect(svc.dispatchInput).toHaveBeenCalledWith('sess1', { kind: 'mouse', type: 'down', x: 5, y: 6 });
  });

  it('destroys the session on disconnect', () => {
    const client = fakeClient('u1');
    client.data.sessionId = 'sess1';
    gw.handleDisconnect(client as never);
    expect(svc.destroy).toHaveBeenCalledWith('sess1');
  });

  it('destroys a prior session when start is called again on the same socket', async () => {
    svc.create.mockResolvedValueOnce('sess1').mockResolvedValueOnce('sess2');
    const client = fakeClient('u1');
    await gw.handleStart(client as never, { url: 'https://ok.example' });
    expect(client.data.sessionId).toBe('sess1');
    await gw.handleStart(client as never, { url: 'https://ok2.example' });
    expect(svc.destroy).toHaveBeenCalledWith('sess1');
    expect(client.data.sessionId).toBe('sess2');
  });
});
