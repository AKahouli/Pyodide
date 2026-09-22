import axios from 'axios';
import { WorkspaceIntegrationEvents } from '@modules/integration-events/contracts';
import { SemanticModelSourceEventHandler } from './semantic-model-source-event.handler';

jest.mock('axios');
const post = axios.post as jest.MockedFunction<typeof axios.post>;

const event = {
  eventId: 'event-1',
  eventType: WorkspaceIntegrationEvents.IndexingReadyV1,
  aggregateType: 'workspace_document',
  aggregateId: 'document-1',
  occurredAt: new Date('2026-09-20T12:00:00Z'),
  payload: { workspaceId: 'workspace-1', documentId: 'document-1' },
};

describe('SemanticModelSourceEventHandler', () => {
  beforeEach(() => post.mockReset().mockResolvedValue({}));

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
    expect(post).toHaveBeenCalledWith(
      'http://semantic-runtime:8090/v1/semantic-model-datasource/events',
      { eventId: 'event-1', eventType: event.eventType,
        occurredAt: '2026-09-20T12:00:00.000Z', payload: event.payload },
      { headers: { 'Content-Type': 'application/json', 'X-Semantic-Service-Key': 'secret' }, timeout: 5000 },
    );
  });

  it('does nothing while runtime writes are disabled', async () => {
    const handler = new SemanticModelSourceEventHandler(
      { register: jest.fn() } as any,
      { runtimeEnabled: true, runtimeWritesEnabled: false } as any,
    );
    await handler.handle(event);
    expect(post).not.toHaveBeenCalled();
  });

  it('surfaces relay failures for outbox retry', async () => {
    post.mockRejectedValue(new Error('runtime unavailable'));
    const handler = new SemanticModelSourceEventHandler(
      { register: jest.fn() } as any,
      { runtimeEnabled: true, runtimeWritesEnabled: true, runtimeUrl: 'http://runtime',
        runtimeServiceKey: 'secret', runtimeRequestTimeoutMs: 5000 } as any,
    );
    await expect(handler.handle(event)).rejects.toThrow('runtime unavailable');
  });
});
