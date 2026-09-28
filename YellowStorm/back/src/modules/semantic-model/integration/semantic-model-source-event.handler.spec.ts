import { WorkspaceIntegrationEvents } from '@modules/integration-events/contracts';
import { SemanticModelSourceEventHandler } from './semantic-model-source-event.handler';

const event = {
  eventId: 'event-1',
  eventType: WorkspaceIntegrationEvents.IndexingReadyV1,
  aggregateType: 'workspace_document',
  aggregateId: 'document-1',
  occurredAt: new Date('2026-09-20T12:00:00Z'),
  payload: { workspaceId: 'workspace-1', documentId: 'document-1' },
};

describe('SemanticModelSourceEventHandler', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('registers and relays source events with service authentication', async () => {
    const registry = { register: jest.fn() };
    const config = {
      runtimeEnabled: true,
      runtimeWritesEnabled: true,
      runtimeUrl: 'http://semantic-runtime:8090/',
      runtimeServiceKey: 'secret',
      runtimeRequestTimeoutMs: 5000,
    };
    const handler = new SemanticModelSourceEventHandler(registry as any, config as any);
    handler.onModuleInit();
    await handler.handle(event);

    expect(registry.register).toHaveBeenCalledWith(handler);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://semantic-runtime:8090/v1/semantic-model-datasource/events');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Semantic-Service-Key': 'secret' });
    expect(JSON.parse(init.body)).toEqual({
      eventId: 'event-1', eventType: event.eventType,
      occurredAt: '2026-09-20T12:00:00.000Z', payload: event.payload,
    });
  });

  it('does nothing while runtime writes are disabled', async () => {
    const handler = new SemanticModelSourceEventHandler(
      { register: jest.fn() } as any,
      { runtimeEnabled: true, runtimeWritesEnabled: false } as any,
    );
    await handler.handle(event);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces relay failures for outbox retry', async () => {
    fetchMock.mockRejectedValue(new Error('runtime unavailable'));
    const handler = new SemanticModelSourceEventHandler(
      { register: jest.fn() } as any,
      { runtimeEnabled: true, runtimeWritesEnabled: true, runtimeUrl: 'http://runtime',
        runtimeServiceKey: 'secret', runtimeRequestTimeoutMs: 5000 } as any,
    );
    await expect(handler.handle(event)).rejects.toThrow('runtime unavailable');
  });
});
