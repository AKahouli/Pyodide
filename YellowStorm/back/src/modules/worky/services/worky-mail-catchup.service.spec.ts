import { WorkyMailCatchupService } from './worky-mail-catchup.service';

const TOKEN = 'YW-abcdefghijklmnop1234';

const SUB = {
  _id: 'sub-oid',
  userId: 'u1',
  mailboxAppKey: 'microsoft',
  lastSweptAt: new Date('2026-07-17T10:00:00Z'),
};

function mail(subject: string, from = 'x@example.com') {
  return {
    subject,
    body: { content: '<p>Yellow Systems.</p>' },
    bodyPreview: 'Yellow Systems.',
    from: { emailAddress: { address: from } },
  };
}

function build(messages: Array<Record<string, unknown>>, delivered = true) {
  const updateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
  const subscriptionModel = {
    find: jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve([SUB]) }),
    }),
    updateOne,
  };
  const graphClient = { listInboxMessagesSince: jest.fn().mockResolvedValue(messages) };
  const orchestrator = {
    deliverMailReply: jest
      .fn()
      .mockResolvedValue({ delivered, sessionId: 's1', stepId: 'wait' }),
  };
  const turnContext = {
    resolveManagerModel: jest.fn().mockResolvedValue('openai/gpt-4o-mini'),
    resolveConnectors: jest.fn().mockResolvedValue([{ connector_id: 'c1' }]),
  };
  const logger = {
    setContext: jest.fn(), log: jest.fn(), warn: jest.fn(),
    error: jest.fn(), debug: jest.fn(),
  };
  const service = new WorkyMailCatchupService(
    subscriptionModel as any, graphClient as any, orchestrator as any, turnContext as any, logger as any,
  );
  return { service, subscriptionModel, graphClient, orchestrator, turnContext, logger, updateOne };
}

describe('WorkyMailCatchupService', () => {
  it('recovers a reply the webhook never delivered', async () => {
    // The case that needs this most: the reply arrived before its step parked,
    // so it was deliberately not claimable and that notification is spent. Only
    // a re-offer picks it up.
    const { service, orchestrator } = build([mail(`Re: Which company? [${TOKEN}]`)]);
    await service.sweep();

    expect(orchestrator.deliverMailReply).toHaveBeenCalledWith(
      expect.objectContaining({
        token: TOKEN,
        replyBody: 'Yellow Systems.',
        replyFrom: 'x@example.com',
      }),
    );
  });

  it('resolves real connectors and a model for the mailbox owner, not none', async () => {
    // Same bug as the webhook path: without this, resume_turn rebuilds every
    // not-yet-run step with ZERO tools -- a step needing one silently
    // fabricates a "done" result instead of actually acting.
    const { service, turnContext, orchestrator } = build([mail(`Re: Q [${TOKEN}]`)]);
    await service.sweep();

    expect(turnContext.resolveConnectors).toHaveBeenCalledWith(SUB.userId);
    expect(orchestrator.deliverMailReply).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-4o-mini',
        connectors: [{ connector_id: 'c1' }],
      }),
    );
  });

  it('resolves connectors only once per sweep, even with several matching messages', async () => {
    const { service, turnContext } = build([
      mail(`Re: A [${TOKEN}]`), mail(`Re: B [${TOKEN}2]`),
    ]);
    await service.sweep();
    expect(turnContext.resolveConnectors).toHaveBeenCalledTimes(1);
  });

  it('never resolves connectors when no swept mail carries a token', async () => {
    const { service, turnContext } = build([mail('Lunch?')]);
    await service.sweep();
    expect(turnContext.resolveConnectors).not.toHaveBeenCalled();
  });

  it('re-offers tokens already delivered without complaining', async () => {
    // The normal case: the webhook got there first, so the wait is claimed and
    // worky answers delivered=false. Replaying the inbox has to be boring.
    const { service, logger } = build([mail(`Re: Q [${TOKEN}]`)], false);
    await service.sweep();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('ignores ordinary mail', async () => {
    const { service, orchestrator } = build([mail('Lunch?'), mail('Re: invoice')]);
    await service.sweep();
    expect(orchestrator.deliverMailReply).not.toHaveBeenCalled();
  });

  it('sweeps from the last cursor, with overlap rather than trusting clocks', async () => {
    const { service, graphClient } = build([]);
    await service.sweep();

    const since = graphClient.listInboxMessagesSince.mock.calls[0][2] as Date;
    expect(since.getTime()).toBeLessThan(SUB.lastSweptAt.getTime());
    expect(graphClient.listInboxMessagesSince).toHaveBeenCalledWith(
      'u1', 'microsoft', expect.any(Date),
    );
  });

  it('re-reads the window when a delivery throws, instead of skipping it', async () => {
    // The cursor only moves once the whole window delivered. A sweep that dies
    // half way must not step over the replies it never reached — and replaying
    // costs nothing, since a wait can only be claimed once.
    const { service, orchestrator, updateOne } = build([mail(`Re: Q [${TOKEN}]`)]);
    orchestrator.deliverMailReply.mockRejectedValueOnce(new Error('grpc down'));

    await service.sweep();
    expect(updateOne).not.toHaveBeenCalled();

    orchestrator.deliverMailReply.mockResolvedValue({
      delivered: true, sessionId: 's1', stepId: 'wait',
    });
    await service.sweep(); // the retry gets there, and now commits the cursor
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(orchestrator.deliverMailReply).toHaveBeenCalledTimes(2);
  });

  it('keeps sweeping other mailboxes when one fails', async () => {
    const { service, graphClient, logger } = build([]);
    graphClient.listInboxMessagesSince.mockRejectedValueOnce(new Error('token expired'));
    await expect(service.sweep()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
