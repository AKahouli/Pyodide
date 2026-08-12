import { Types } from 'mongoose';
import { GovernanceDocumentReviewSchedulerService } from './governance-document-review-scheduler.service';

describe('GovernanceDocumentReviewSchedulerService', () => {
  it('marks due documents once and emits a deduplicated event', async () => {
    const document = { _id: new Types.ObjectId(), programId: new Types.ObjectId(), documentId: new Types.ObjectId(), validity: { businessStatus: 'valid', nextReviewAt: new Date('2026-07-01T00:00:00.000Z') } };
    const model = { find: jest.fn(() => ({ sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([document]) })), updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })) };
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceDocumentReviewSchedulerService(model as never, events as never, { get: jest.fn() } as never);
    await expect(service.run(new Date('2026-07-30T00:00:00.000Z'))).resolves.toBe(1);
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ documentId: document.documentId.toString(), eventType: 'validity.review_due' }));
  });
});
