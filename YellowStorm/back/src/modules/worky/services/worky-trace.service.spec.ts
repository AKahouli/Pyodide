import { Types } from 'mongoose';
import { WorkyTraceService } from './worky-trace.service';

const makeService = () => {
  const streamObjectId = new Types.ObjectId();
  const taskObjectId = new Types.ObjectId();
  const traceObjectId = new Types.ObjectId();
  const baseTrace = {
    _id: traceObjectId,
    streamId: streamObjectId,
    taskId: taskObjectId,
    kind: 'tool',
    name: 'gmail.send',
    summary: 'sent an email',
    rawPayloadUri: 's3://trace-secret/abc',
    durationMs: 1234,
    createdAt: new Date(),
  };
  const traces = {
    create: jest.fn().mockImplementation((doc) =>
      Promise.resolve({ _id: new Types.ObjectId(), createdAt: new Date(), ...doc }),
    ),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([baseTrace]),
        }),
      }),
    }),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const service = new WorkyTraceService(traces as any, logger as any);
  return { service, traces, baseTrace };
};

describe('WorkyTraceService.record', () => {
  it('persists a trace and returns the response (raw payload present in storage)', async () => {
    const { service, traces } = makeService();
    const result = await service.record({
      streamId: new Types.ObjectId().toString(),
      taskId: new Types.ObjectId().toString(),
      kind: 'tool',
      name: 'gmail.send',
      summary: 'sent an email',
      rawPayloadUri: 's3://trace/abc',
      durationMs: 1234,
    });
    expect(traces.create).toHaveBeenCalled();
    expect(result.name).toBe('gmail.send');
    // record() returns the persisted row; the list endpoints redact
    // by default. The admin/raw-payload exposure is gated in the
    // list handlers (canonical §19).
    expect(result.rawPayloadUri).toBe('s3://trace/abc');
  });

  it('throws on invalid streamId', async () => {
    const { service } = makeService();
    await expect(
      service.record({
        streamId: 'not-valid',
        taskId: new Types.ObjectId().toString(),
        kind: 'model',
        name: 'x',
      }),
    ).rejects.toThrow(/invalid streamId/);
  });
});

describe('WorkyTraceService redaction', () => {
  it('strips rawPayloadUri by default (canonical §19)', async () => {
    const { service } = makeService();
    const result = await service.listForStream(new Types.ObjectId().toString());
    expect(result[0].rawPayloadUri).toBeNull();
  });
  it('returns rawPayloadUri when redactRawPayload=false (admin path)', async () => {
    const { service } = makeService();
    const result = await service.listForStream(new Types.ObjectId().toString(), {
      redactRawPayload: false,
    });
    expect(result[0].rawPayloadUri).toBe('s3://trace-secret/abc');
  });
  it('listForTask also redacts by default', async () => {
    const { service } = makeService();
    const result = await service.listForTask(
      new Types.ObjectId().toString(),
      new Types.ObjectId().toString(),
    );
    expect(result[0].rawPayloadUri).toBeNull();
  });
});
