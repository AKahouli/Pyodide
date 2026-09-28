import { newObjectId } from '@common/postgres';
import { WorkyTraceService } from './worky-trace.service';
import type { WorkyTraceRecord } from '../worky.types';

const makeService = () => {
  const baseTrace: WorkyTraceRecord = {
    id: newObjectId(),
    streamId: newObjectId(),
    taskId: newObjectId(),
    kind: 'tool',
    name: 'gmail.send',
    summary: 'sent an email',
    rawPayloadUri: 's3://trace-secret/abc',
    durationMs: 1234,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const audits = {
    createTrace: jest.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      id: newObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    })),
    listTracesForStream: jest.fn().mockResolvedValue([baseTrace]),
    listTracesForTask: jest.fn().mockResolvedValue([baseTrace]),
  };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const service = new WorkyTraceService(audits as never, logger as never);
  return { service, audits, baseTrace };
};

describe('WorkyTraceService.record', () => {
  it('persists a trace and returns the response (raw payload present in storage)', async () => {
    const { service, audits } = makeService();
    const streamId = newObjectId();
    const taskId = newObjectId();
    const result = await service.record({
      streamId,
      taskId,
      kind: 'tool',
      name: 'gmail.send',
      summary: 'sent an email',
      rawPayloadUri: 's3://trace/abc',
      durationMs: 1234,
    });
    expect(audits.createTrace).toHaveBeenCalledWith({
      streamId,
      taskId,
      kind: 'tool',
      name: 'gmail.send',
      summary: 'sent an email',
      rawPayloadUri: 's3://trace/abc',
      durationMs: 1234,
    });
    expect(result).toMatchObject({ streamId, taskId, name: 'gmail.send' });
    // record() returns the persisted row; the list endpoints redact
    // by default. The admin/raw-payload exposure is gated in the
    // list handlers (canonical §19).
    expect(result.rawPayloadUri).toBe('s3://trace/abc');
  });

  it('defaults the optional fields', async () => {
    const { service, audits } = makeService();
    await service.record({ streamId: newObjectId(), taskId: newObjectId(), kind: 'model', name: 'gpt' });
    expect(audits.createTrace).toHaveBeenCalledWith(expect.objectContaining({ summary: '', rawPayloadUri: null, durationMs: 0 }));
  });

  it('throws on invalid streamId or taskId', async () => {
    const { service, audits } = makeService();
    await expect(
      service.record({ streamId: 'not-valid', taskId: newObjectId(), kind: 'model', name: 'x' }),
    ).rejects.toThrow(/invalid streamId/);
    await expect(
      service.record({ streamId: newObjectId(), taskId: 'not-valid', kind: 'model', name: 'x' }),
    ).rejects.toThrow(/invalid taskId/);
    expect(audits.createTrace).not.toHaveBeenCalled();
  });

  it('reports a task that does not exist as a clear error', async () => {
    const { service, audits } = makeService();
    audits.createTrace.mockRejectedValueOnce(Object.assign(new Error('violates foreign key constraint'), { code: '23503' }));
    const streamId = newObjectId();
    const taskId = newObjectId();
    await expect(service.record({ streamId, taskId, kind: 'tool', name: 'x' })).rejects.toThrow(
      `WorkyTraceService.record: task ${taskId} not found in stream ${streamId}`,
    );
  });

  it('lets any other database error through unchanged', async () => {
    const { service, audits } = makeService();
    const failure = new Error('connection terminated');
    audits.createTrace.mockRejectedValueOnce(failure);
    await expect(service.record({ streamId: newObjectId(), taskId: newObjectId(), kind: 'tool', name: 'x' })).rejects.toBe(failure);
  });
});

describe('WorkyTraceService redaction', () => {
  it('strips rawPayloadUri by default (canonical §19)', async () => {
    const { service, audits } = makeService();
    const streamId = newObjectId();
    const result = await service.listForStream(streamId);
    expect(audits.listTracesForStream).toHaveBeenCalledWith(streamId, 500);
    expect(result[0].rawPayloadUri).toBeNull();
  });
  it('returns rawPayloadUri when redactRawPayload=false (admin path)', async () => {
    const { service } = makeService();
    const result = await service.listForStream(newObjectId(), {
      redactRawPayload: false,
    });
    expect(result[0].rawPayloadUri).toBe('s3://trace-secret/abc');
  });
  it('listForTask also redacts by default', async () => {
    const { service, audits } = makeService();
    const streamId = newObjectId();
    const taskId = newObjectId();
    const result = await service.listForTask(streamId, taskId);
    expect(audits.listTracesForTask).toHaveBeenCalledWith(streamId, taskId, 200);
    expect(result[0].rawPayloadUri).toBeNull();
  });
  it('returns nothing for malformed ids', async () => {
    const { service, audits } = makeService();
    expect(await service.listForStream('nope')).toEqual([]);
    expect(await service.listForTask(newObjectId(), 'nope')).toEqual([]);
    expect(audits.listTracesForStream).not.toHaveBeenCalled();
    expect(audits.listTracesForTask).not.toHaveBeenCalled();
  });
});
