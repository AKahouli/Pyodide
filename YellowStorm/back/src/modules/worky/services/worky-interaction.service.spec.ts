import { newObjectId } from '@common/postgres';
import { WorkyInteractionService } from './worky-interaction.service';
import type { WorkyInteractionRecord } from '../worky.types';

describe('WorkyInteractionService.respond', () => {
  const streamId = newObjectId();
  const interactionId = newObjectId();
  const taskId = newObjectId();
  const ownerId = newObjectId();
  const userId = newObjectId();

  const makeService = (over: Partial<WorkyInteractionRecord> = {}) => {
    const record: WorkyInteractionRecord = {
      id: interactionId,
      streamId,
      taskId,
      type: 'clarification',
      targetUserId: null,
      question: 'Which doc?',
      options: ['A', 'B'],
      status: 'pending',
      blockingScope: 'task',
      blocksTaskIds: [taskId],
      respondedAt: null,
      response: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
    const interactions = {
      findById: jest.fn().mockResolvedValue(record),
      // Mirrors the conditional update: only a pending interaction takes the answer.
      respond: jest.fn(async (_id: string, outcome: { status: string; response: string }) =>
        record.status === 'pending' ? { ...record, ...outcome, respondedAt: new Date() } : null),
    };
    const streams = { findById: jest.fn().mockResolvedValue({ id: streamId, ownerUserId: ownerId, shares: [] }) };
    const events = { emit: jest.fn() };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const service = new WorkyInteractionService(interactions as never, streams as never, events as never, logger as never);
    return { service, record, interactions, streams, events, logger };
  };

  it('marks the interaction as responded and emits interaction.responded to the owner', async () => {
    const { service, interactions, streams, events } = makeService();

    const result = await service.respond({ userId, interactionId, dto: { content: 'Doc A' } });

    expect(interactions.respond).toHaveBeenCalledWith(interactionId, { status: 'responded', response: 'Doc A' });
    expect(streams.findById).toHaveBeenCalledWith(streamId);
    expect(events.emit).toHaveBeenCalledWith(ownerId, streamId, expect.objectContaining({
      type: 'interaction.responded',
      payload: {
        interactionId,
        type: 'clarification',
        taskId,
        status: 'responded',
        response: 'Doc A',
        verdict: null,
        blocksTaskIds: [taskId],
      },
    }));
    expect(result).toEqual({
      interactionId,
      streamId,
      status: 'responded',
      response: 'Doc A',
      verdict: null,
      followUpTurnStarted: false,
    });
  });

  it('marks the interaction as canceled with an empty response when dto.cancel is true', async () => {
    const { service, interactions } = makeService();

    const result = await service.respond({ userId, interactionId, dto: { content: 'ignored', cancel: true } });

    expect(interactions.respond).toHaveBeenCalledWith(interactionId, { status: 'canceled', response: '' });
    expect(result.status).toBe('canceled');
    expect(result.response).toBe('');
  });

  it('throws on a non-existent interaction', async () => {
    const { service, interactions } = makeService();
    interactions.findById.mockResolvedValue(null);

    await expect(service.respond({ userId, interactionId, dto: { content: 'x' } })).rejects.toMatchObject({ code: 'ERR_3510' });
    expect(interactions.respond).not.toHaveBeenCalled();
  });

  it('throws on an already-responded interaction', async () => {
    const { service, events } = makeService({ status: 'responded' });

    await expect(service.respond({ userId, interactionId, dto: { content: 'x' } })).rejects.toMatchObject({ code: 'ERR_3512' });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('throws when a concurrent response wins between the read and the write', async () => {
    const { service, interactions, events } = makeService();
    interactions.respond.mockResolvedValueOnce(null);

    await expect(service.respond({ userId, interactionId, dto: { content: 'x' } })).rejects.toMatchObject({ code: 'ERR_3512' });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('still answers but drops the SSE frame when the stream is gone', async () => {
    const { service, streams, events, logger } = makeService();
    streams.findById.mockResolvedValue(null);

    const result = await service.respond({ userId, interactionId, dto: { content: 'Doc A' } });

    expect(result.status).toBe('responded');
    expect(logger.warn).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith('', streamId, expect.objectContaining({ type: 'interaction.responded' }));
  });

  it('derives an approved verdict from `approve: true` for an approval interaction', async () => {
    const { service, events } = makeService({ type: 'approval' });

    const result = await service.respond({ userId, interactionId, dto: { content: 'approved', approve: true } });

    expect(result.verdict).toBe('approved');
    expect(events.emit).toHaveBeenCalledWith(ownerId, streamId, expect.objectContaining({
      type: 'interaction.responded',
      payload: expect.objectContaining({ verdict: 'approved' }),
    }));
  });

  it('derives a rejected verdict from `approve: false` for an approval interaction', async () => {
    const { service } = makeService({ type: 'approval' });
    const result = await service.respond({ userId, interactionId, dto: { content: 'rejected', approve: false } });
    expect(result.verdict).toBe('rejected');
  });

  it('returns a null verdict when an approval interaction is canceled', async () => {
    const { service } = makeService({ type: 'approval' });
    const result = await service.respond({ userId, interactionId, dto: { content: 'x', cancel: true, approve: true } });
    expect(result.verdict).toBeNull();
  });

  it('returns null verdict for non-approval interactions', async () => {
    const { service } = makeService({ type: 'clarification' });
    const result = await service.respond({ userId, interactionId, dto: { content: 'Doc A', approve: true } });
    expect(result.verdict).toBeNull();
  });

  it('derives an approved verdict for replan_review interactions (gates applyApproved)', async () => {
    // Regression: previously replan_review was treated as
    // non-approval-like and the verdict stayed null, which made
    // the controller's `verdict === 'approved'` gate unreachable
    // and the replan apply path dead code.
    const { service } = makeService({ type: 'replan_review' });
    const result = await service.respond({ userId, interactionId, dto: { content: 'go', approve: true } });
    expect(result.verdict).toBe('approved');
  });
});
