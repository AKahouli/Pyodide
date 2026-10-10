import { StreamService } from './stream.service';

describe('Nonblocking synthesis capability readiness', () => {
  function fixture() {
    const capability = { background_protocol_version: 1, background_ready: true,
      background_fanout_protocol_version: 1, background_fanout_ready: true,
      background_followup_protocol_version: 2, background_followup_ready: true, control_database_fingerprint: 'database' };
    const context = { configService: { get: (name: string) => name === 'conversation.rootBackgroundEnabled' ? true : 'fixture-key' },
      rootBackgroundJobs: { controlInstance: jest.fn().mockResolvedValue('database') }, waitForGrpcReady: jest.fn().mockResolvedValue(true),
      getChatbotClient: () => ({ RunBackgroundInvocation: jest.fn(),
        GetRootWorkCapabilities: (_request: unknown, _metadata: unknown, _options: unknown, done: Function) => done(null, capability) }) };
    const ready = () => StreamService.prototype.rootBackgroundReady.call(context as any, true, true);
    return { ready, context, capability };
  }
  it('rejects the old writer-reserving receiver and accepts the nonblocking receiver', async () => {
    const h = fixture();
    h.capability.background_followup_protocol_version = 1;
    expect(await h.ready()).toBe(false);
    h.capability.background_followup_protocol_version = 2;
    expect(await h.ready()).toBe(true);
  });
  it('still requires followup readiness and the same control database', async () => {
    const h = fixture(); h.capability.background_followup_ready = false;
    expect(await h.ready()).toBe(false);
    h.capability.background_followup_ready = true; h.capability.control_database_fingerprint = 'other';
    expect(await h.ready()).toBe(false);
  });
});
