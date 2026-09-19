import { Types } from 'mongoose';
import { GovernanceDocumentReviewSchedulerService } from './governance-document-review-scheduler.service';

describe('GovernanceDocumentReviewSchedulerService', () => {
  function document(overrides: Record<string, unknown> = {}) {
    return { id: new Types.ObjectId().toString(), programId: new Types.ObjectId().toString(), documentId: new Types.ObjectId().toString(), validity: { businessStatus: 'valid', nextReviewAt: new Date('2026-07-01T00:00:00.000Z') }, ...overrides };
  }

  it('marks due documents once and emits a deduplicated event', async () => {
    const doc = document();
    const documentStore = { listDueForReview: jest.fn().mockResolvedValue([doc]), markNeedsReviewIfUnchanged: jest.fn().mockResolvedValue(true) };
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceDocumentReviewSchedulerService(documentStore as never, events as never, { isEnabled: jest.fn().mockReturnValue(true) } as never);
    await expect(service.run(new Date('2026-07-30T00:00:00.000Z'))).resolves.toBe(1);
    expect(documentStore.markNeedsReviewIfUnchanged).toHaveBeenCalledWith(doc.id, 'valid', new Date('2026-07-01T00:00:00.000Z'));
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ documentId: doc.documentId, eventType: 'validity.review_due', deduplicationKey: 'review-due:2026-07-01T00:00:00.000Z' }));
  });

  it('skips a document and emits no event when the optimistic guard loses the race', async () => {
    const doc = document();
    const documentStore = { listDueForReview: jest.fn().mockResolvedValue([doc]), markNeedsReviewIfUnchanged: jest.fn().mockResolvedValue(false) };
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceDocumentReviewSchedulerService(documentStore as never, events as never, { isEnabled: jest.fn().mockReturnValue(true) } as never);
    // Race simulation: another runner flipped the document between the
    // selection and the guarded update (rowCount 0 in PostgreSQL terms).
    await expect(service.run(new Date('2026-07-30T00:00:00.000Z'))).resolves.toBe(0);
    expect(events.append).not.toHaveBeenCalled();
  });

  it('does nothing when the validity intelligence feature gate is off', async () => {
    const documentStore = { listDueForReview: jest.fn() };
    const service = new GovernanceDocumentReviewSchedulerService(documentStore as never, { append: jest.fn() } as never, { isEnabled: jest.fn().mockReturnValue(false) } as never);
    await expect(service.scheduleDueReviews()).resolves.toBeUndefined();
    expect(documentStore.listDueForReview).not.toHaveBeenCalled();
  });
});
