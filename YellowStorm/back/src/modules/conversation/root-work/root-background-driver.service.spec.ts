import { EventEmitter } from 'node:events';
import { RootBackgroundDriverService } from './root-background-driver.service';

describe('Durable background driver', () => {
  function fixture(enabled = true) {
    const config = { get: jest.fn((key: string, fallback: unknown) => key === 'conversation.rootBackgroundEnabled' ? enabled : fallback) };
    const jobs = { claim: jest.fn(), markDispatched: jest.fn().mockResolvedValue(true),
      heartbeat: jest.fn().mockResolvedValue(true), controlInstance: jest.fn().mockResolvedValue('database') };
    const call = Object.assign(new EventEmitter(), { pause: jest.fn(), resume: jest.fn(), cancel: jest.fn() });
    const client = { RunBackgroundInvocation: jest.fn(() => call) };
    const stream = { rootBackgroundReady: jest.fn().mockResolvedValue(true), getChatbotClient: jest.fn(() => client) };
    const driver = new RootBackgroundDriverService(jobs as any, stream as any, config as any);
    return { driver, jobs, stream, call, client };
  }

  it('disabled startup does not poll, query capabilities or claim jobs', async () => {
    const h = fixture(false);
    h.driver.onModuleInit();
    await h.driver.onModuleDestroy();
    expect(h.jobs.claim).not.toHaveBeenCalled();
    expect(h.stream.rootBackgroundReady).not.toHaveBeenCalled();
  });

  it('uses the versioned RPC and EOF never writes a terminal job outcome', async () => {
    const h = fixture();
    const job = { executionId: 'execution', conversationId: 'conversation', actorId: 'actor',
      conversationEpoch: 3, fence: 2, requestDigest: 'digest', deadline: new Date(Date.now() + 30000) };
    const dispatch = (h.driver as any).dispatch(job, new AbortController());
    await new Promise(setImmediate);
    expect(h.client.RunBackgroundInvocation).toHaveBeenCalledWith(expect.objectContaining({ protocol_version: 1,
      execution_id: 'execution', fence: 2, conversation_epoch: 3, control_database_fingerprint: 'database' }), expect.anything());
    h.call.emit('data', { execution_id: 'execution', status: 'running' });
    h.call.emit('end');
    await dispatch;
    expect(h.jobs.claim).not.toHaveBeenCalled();
    expect(h.call.cancel).not.toHaveBeenCalled();
  });
});
