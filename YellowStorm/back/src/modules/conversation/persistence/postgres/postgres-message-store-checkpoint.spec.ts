import { inspect } from 'node:util';
import { PostgresMessageStore } from './postgres-message-store';

describe('stream checkpoints and recovery', () => {
  const returning = jest.fn();
  const where = jest.fn((_condition: unknown) => ({ returning }));
  const set = jest.fn((_values: Record<string, unknown>) => ({ where }));
  const update = jest.fn(() => ({ set }));
  const store = new PostgresMessageStore({ update } as never);
  beforeEach(() => { jest.clearAllMocks(); returning.mockResolvedValue([{ id: 'answer' }]); });

  it('checkpoints components under the active owner and incomplete guard', async () => {
    const components = [{ id: 'text', type: 'text' as const, data: { content: 'Partial' } }];
    await expect(store.renewStream('answer', 'owner', new Date(), components)).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ components }));
    const condition = inspect(where.mock.calls[0][0], { depth: 16 });
    expect(condition).toContain('owner');
    expect(condition).toContain('stream_execution_lease_id');
    expect(condition).toContain('is_complete');
  });

  it('does not report success after lease ownership is lost', async () => {
    returning.mockResolvedValueOnce([]);
    await expect(store.renewStream('answer', 'old-owner', new Date(), [])).resolves.toBe(false);
  });

  it('retains the snapshot and appends a visible interruption marker atomically', async () => {
    await store.markExecutionInterrupted('answer', 'lease_expired', new Date());
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ isComplete: false, isStreaming: false, executionStatus: 'interrupted' }));
    const update = inspect(set.mock.calls[0][0].components, { depth: 16 });
    expect(update).toContain('COALESCE');
    expect(update).toContain('interrupted-answer');
    expect(update).toContain('interrupted');
    expect(inspect(where.mock.calls[0][0], { depth: 16 })).toContain('stream_execution_lease_expires_at');
  });
});
