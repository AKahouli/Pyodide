import { KnowledgeRecommendationRepositoryService } from './knowledge-recommendation-repository.service';

describe('KnowledgeRecommendationRepositoryService', () => {
  const programId = '64b000000000000000000001';
  const recommendationId = '64b000000000000000000002';
  const actorId = '64b000000000000000000003';
  const scopeId = '64b000000000000000000004';

  it('claims an accepted recommendation with a bounded application lease', async () => {
    const exec = jest.fn().mockResolvedValue({ applicationToken: 'token' });
    const findOneAndUpdate = jest.fn((_filter: unknown, _update: unknown, _options?: unknown) => ({ exec }));
    const model = { findOneAndUpdate };
    const service = new KnowledgeRecommendationRepositoryService(model as never);

    await service.beginApply(programId, recommendationId, [scopeId]);

    const [filter, update, options] = findOneAndUpdate.mock.calls[0] as [Record<string, unknown>, { $set: Record<string, unknown> }, unknown];
    expect(filter).toMatchObject({ status: 'accepted', $and: expect.any(Array) });
    expect(filter.$and).toHaveLength(2);
    expect(update.$set.applicationToken).toEqual(expect.any(String));
    expect(update.$set.applicationLeaseExpiresAt).toEqual(expect.any(Date));
    expect(options).toEqual({ new: true });
  });

  it('requires the lease token when completing an application', async () => {
    const exec = jest.fn().mockResolvedValue({ status: 'applied' });
    const findOneAndUpdate = jest.fn((_filter: unknown, _update: unknown, _options?: unknown) => ({ exec }));
    const model = { findOneAndUpdate };
    const service = new KnowledgeRecommendationRepositoryService(model as never);

    await service.markApplied(recommendationId, actorId, 'lease-token');

    const [filter, update] = findOneAndUpdate.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(filter).toMatchObject({ status: 'accepted', applicationToken: 'lease-token' });
    expect(update).toMatchObject({
      $set: { status: 'applied' },
      $unset: { applicationToken: 1, applicationLeaseExpiresAt: 1 },
    });
  });

  it('treats the owner wildcard as program-wide access without parsing it as an object id', async () => {
    const exec = jest.fn().mockResolvedValue({ status: 'accepted' });
    const findOneAndUpdate = jest.fn((_filter: unknown, _update: unknown, _options?: unknown) => ({ exec }));
    const service = new KnowledgeRecommendationRepositoryService({ findOneAndUpdate } as never);

    await service.decide(programId, recommendationId, actorId, 'accept', ['*']);

    const [filter] = findOneAndUpdate.mock.calls[0] as [Record<string, unknown>, unknown, unknown?];
    expect(filter).toMatchObject({ status: 'proposed' });
    expect(filter).not.toHaveProperty('$or');
  });

  it('omits the scope predicate for program-wide owner listings', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const limit = jest.fn(() => ({ exec }));
    const sort = jest.fn(() => ({ limit }));
    const find = jest.fn((_query: unknown) => ({ sort }));
    const service = new KnowledgeRecommendationRepositoryService({ find } as never);

    await service.list(programId, { scopeIds: ['*'] });

    expect(find).toHaveBeenCalledWith(expect.not.objectContaining({ $or: expect.anything() }));
  });

  it('updates generated payloads only while the recommendation is still proposed', async () => {
    const existingId = '64b000000000000000000005';
    const existingExec = jest.fn().mockResolvedValue({ _id: existingId });
    const findOne = jest.fn(() => ({ select: () => ({ lean: () => ({ exec: existingExec }) }) }));
    const updateOne = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }));
    const updateMany = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }));
    const service = new KnowledgeRecommendationRepositoryService({ findOne, updateOne, updateMany } as never);

    await service.synchronize('64b000000000000000000006', [{
      programId,
      scopeIds: [scopeId],
      sourceId: '64b000000000000000000007',
      sourceVersionId: '64b000000000000000000006',
      alertIds: [],
      type: 'schedule_review',
      priority: 'medium',
      reason: 'Review cadence is missing.',
      impactSummary: 'A schedule will improve freshness.',
      proposedAction: { reviewFrequencyDays: 30 },
      deduplicationKey: 'schedule-review',
    }]);

    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: existingId, status: 'proposed' }),
      expect.objectContaining({ $set: expect.objectContaining({ proposedAction: { reviewFrequencyDays: 30 } }) }),
    );
  });
});
