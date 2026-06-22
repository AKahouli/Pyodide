import { Types } from 'mongoose';
import { WorkyIdempotencyService } from './worky-idempotency.service';

describe('WorkyIdempotencyService.claim', () => {
  const streamId = new Types.ObjectId().toString();
  const eventId = 'evt-1';
  const callback = 'plan-delta';

  const makeService = (overrides: { createImpl?: jest.Mock; findOneImpl?: jest.Mock } = {}) => {
    const create = overrides.createImpl ?? jest.fn().mockImplementation((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc }));
    const findOne = overrides.findOneImpl ?? jest.fn();
    const model = { create, findOne };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    return { service: new WorkyIdempotencyService(model as any, logger as any), create, findOne };
  };

  it('returns firstSeen=true on the first delivery', async () => {
    const { service, create } = makeService();
    const result = await service.claim(streamId, eventId, callback);
    expect(result.firstSeen).toBe(true);
    expect(result.replay).toBe(false);
    expect(create).toHaveBeenCalledWith({
      streamId: new Types.ObjectId(streamId),
      eventId,
      callback,
    });
  });

  it('returns firstSeen=false on a duplicate (idempotent replay)', async () => {
    const existing = { _id: new Types.ObjectId(), streamId: new Types.ObjectId(streamId), eventId };
    const findOneExec = jest.fn().mockResolvedValue(existing);
    const findOne = jest.fn().mockReturnValue({ exec: findOneExec });
    const { service } = makeService({
      createImpl: jest.fn().mockImplementation(() => {
        const err: Error & { code?: number } = new Error('E11000 duplicate key');
        err.code = 11000;
        return Promise.reject(err);
      }),
      findOneImpl: findOne,
    });

    const result = await service.claim(streamId, eventId, callback);
    expect(result.firstSeen).toBe(false);
    expect(result.replay).toBe(true);
    expect(result.record).toBe(existing);
  });

  it('rejects malformed eventIds', async () => {
    const { service } = makeService();
    await expect(
      service.claim(streamId, '', callback),
    ).rejects.toThrow(/eventId/);
  });

  it('rejects malformed streamIds', async () => {
    const { service } = makeService();
    await expect(
      service.claim('not-an-objectid', eventId, callback),
    ).rejects.toThrow(/streamId/);
  });
});
