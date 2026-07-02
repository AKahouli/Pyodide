import { Types } from 'mongoose';
import { WorkyInteractionService } from './worky-interaction.service';

describe('WorkyInteractionService.respond', () => {
  const streamObjectId = new Types.ObjectId();
  const interactionObjectId = new Types.ObjectId();
  const taskObjectId = new Types.ObjectId();
  const ownerObjectId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const makeService = () => {
    const interactionDoc: any = {
      _id: interactionObjectId,
      streamId: streamObjectId,
      taskId: taskObjectId,
      type: 'clarification',
      question: 'Which doc?',
      options: ['A', 'B'],
      status: 'pending',
      blockingScope: 'task',
      blocksTaskIds: [taskObjectId],
      respondedAt: null,
      response: null,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const interactionsModel = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(interactionDoc) }),
    };
    const streamsModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ ownerUserId: ownerObjectId }) }),
        }),
      }),
    };
    const events = { emit: jest.fn() } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;
    const service = new WorkyInteractionService(
      interactionsModel as any,
      streamsModel as any,
      events,
      logger,
    );
    return { service, interactionDoc, interactionsModel, events };
  };

  it('marks the interaction as responded and emits interaction.responded', async () => {
    const { service, interactionDoc, events } = makeService();
    const result = await service.respond({
      userId,
      interactionId: interactionObjectId.toString(),
      dto: { content: 'Doc A' },
    });
    expect(interactionDoc.status).toBe('responded');
    expect(interactionDoc.response).toBe('Doc A');
    expect(interactionDoc.respondedAt).toBeInstanceOf(Date);
    expect(events.emit).toHaveBeenCalledWith(
      ownerObjectId.toString(),
      streamObjectId.toString(),
      expect.objectContaining({ type: 'interaction.responded' }),
    );
    expect(result.status).toBe('responded');
  });

  it('marks the interaction as canceled when dto.cancel is true', async () => {
    const { service, interactionDoc } = makeService();
    const result = await service.respond({
      userId,
      interactionId: interactionObjectId.toString(),
      dto: { content: '', cancel: true },
    });
    expect(interactionDoc.status).toBe('canceled');
    expect(result.status).toBe('canceled');
  });

  it('throws on a non-existent interaction', async () => {
    const { service } = makeService();
    (service as any).interactions.findById = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.respond({
        userId,
        interactionId: interactionObjectId.toString(),
        dto: { content: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'ERR_3510' });
  });

  it('throws on an already-responded interaction', async () => {
    const { service, interactionDoc } = makeService();
    interactionDoc.status = 'responded';
    await expect(
      service.respond({
        userId,
        interactionId: interactionObjectId.toString(),
        dto: { content: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'ERR_3512' });
  });

  it('derives an approved verdict from `approve: true` for an approval interaction', async () => {
    const { service, interactionDoc, events } = makeService();
    interactionDoc.type = 'approval';
    const result = await service.respond({
      userId,
      interactionId: interactionObjectId.toString(),
      dto: { content: 'approved', approve: true },
    });
    expect(result.verdict).toBe('approved');
    expect(events.emit).toHaveBeenCalledWith(
      ownerObjectId.toString(),
      streamObjectId.toString(),
      expect.objectContaining({
        type: 'interaction.responded',
        payload: expect.objectContaining({ verdict: 'approved' }),
      }),
    );
  });

  it('derives a rejected verdict from `approve: false` for an approval interaction', async () => {
    const { service, interactionDoc } = makeService();
    interactionDoc.type = 'approval';
    const result = await service.respond({
      userId,
      interactionId: interactionObjectId.toString(),
      dto: { content: 'rejected', approve: false },
    });
    expect(result.verdict).toBe('rejected');
  });

  it('returns null verdict for non-approval interactions', async () => {
    const { service, interactionDoc } = makeService();
    interactionDoc.type = 'clarification';
    const result = await service.respond({
      userId,
      interactionId: interactionObjectId.toString(),
      dto: { content: 'Doc A', approve: true },
    });
    expect(result.verdict).toBeNull();
  });

  it('derives an approved verdict for replan_review interactions (gates applyApproved)', async () => {
    // Regression: previously replan_review was treated as
    // non-approval-like and the verdict stayed null, which made
    // the controller's `verdict === 'approved'` gate unreachable
    // and the replan apply path dead code.
    const { service, interactionDoc } = makeService();
    interactionDoc.type = 'replan_review';
    const result = await service.respond({
      userId,
      interactionId: interactionObjectId.toString(),
      dto: { content: 'go', approve: true },
    });
    expect(result.verdict).toBe('approved');
  });
});
