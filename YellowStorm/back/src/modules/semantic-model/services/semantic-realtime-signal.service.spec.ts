import { SemanticRealtimeSignalService } from './semantic-realtime-signal.service';

describe('SemanticRealtimeSignalService', () => {
  it('coalesces through the caller transaction without publishing', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };
    const service = new SemanticRealtimeSignalService({ realtimeEnabled: true } as never);

    await service.enqueue(client as never, '11111111-1111-1111-1111-111111111111', 'model-read-state-changed', {
      reason: 'graph.operations_applied',
    });

    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.query.mock.calls[2][0]).toContain('ui_signal_outbox');
  });

  it('does nothing while realtime is disabled', async () => {
    const client = { query: jest.fn() };
    const service = new SemanticRealtimeSignalService({ realtimeEnabled: false } as never);
    await service.enqueue(client as never, 'model', 'model-read-state-changed');
    expect(client.query).not.toHaveBeenCalled();
  });
});
