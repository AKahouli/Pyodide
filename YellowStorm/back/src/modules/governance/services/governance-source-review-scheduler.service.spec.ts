import { Types } from 'mongoose';
import { GovernanceSourceReviewSchedulerService } from './governance-source-review-scheduler.service';

describe('GovernanceSourceReviewSchedulerService', () => {
  it('marks due active versions for review and records an idempotent audit event', async () => {
    const sourceId = new Types.ObjectId();
    const version = { _id: new Types.ObjectId(), sourceId, programId: new Types.ObjectId(), validity: { businessStatus: 'valid', nextReviewAt: new Date('2026-07-01T00:00:00.000Z') } };
    const versionModel = {
      aggregate: jest.fn().mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) }).mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([version]) }),
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
    };
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const session = { withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()), endSession: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceSourceReviewSchedulerService(versionModel as never, events as never, { get: jest.fn() } as never, { startSession: jest.fn().mockResolvedValue(session) } as never);

    await expect(service.run(new Date('2026-07-13T00:00:00.000Z'))).resolves.toBe(1);

    expect(versionModel.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: version._id, 'validity.businessStatus': 'valid' }), { $set: { 'validity.businessStatus': 'needs_review' } }, { session });
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'validity.review_due', actorType: 'system', deduplicationKey: expect.stringContaining(version._id.toString()) }));
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ session }));
    expect(versionModel.aggregate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ $lookup: expect.objectContaining({ from: 'governance_sources' }) }), expect.objectContaining({ $limit: 100 })]));
  });

  it('repairs a missing due-review audit event for an already marked version', async () => {
    const version = { _id: new Types.ObjectId(), sourceId: new Types.ObjectId(), programId: new Types.ObjectId(), validity: { businessStatus: 'needs_review', nextReviewAt: new Date('2026-07-01T00:00:00.000Z') } };
    const versionModel = { aggregate: jest.fn().mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([version]) }).mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) }) };
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceSourceReviewSchedulerService(versionModel as never, events as never, { get: jest.fn() } as never, { startSession: jest.fn() } as never);

    await expect(service.run(new Date('2026-07-13T00:00:00.000Z'))).resolves.toBe(0);

    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'validity.review_due', metadata: { recovered: true }, deduplicationKey: expect.stringContaining(version._id.toString()) }));
    expect(versionModel.aggregate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ $lookup: expect.objectContaining({ from: 'governance_source_events' }) })]));
  });
});
