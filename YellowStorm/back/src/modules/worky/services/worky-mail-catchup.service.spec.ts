import { newObjectId } from '@common/postgres';
import { WorkyMailCatchupService } from './worky-mail-catchup.service';
import type { WorkyMailSubscriptionRecord } from '../worky.types';

const TOKEN = 'YW-abcdefghijklmnop1234';

const SUB: WorkyMailSubscriptionRecord = {
  id: newObjectId(),
  userId: newObjectId(),
  mailboxAppKey: 'microsoft',
  subscriptionId: null,
  clientState: null,
  expiresAt: null,
  notificationUrl: null,
  lastSweptAt: new Date('2026-07-17T10:00:00Z'),
  createdAt: new Date('2026-07-01T10:00:00Z'),
  updatedAt: new Date('2026-07-17T10:00:00Z'),
};

function mail(subject: string, from = 'x@example.com', body = 'Yellow Systems.') {
  return {
    subject,
    // contentType set, matching a real Graph message.
    body: { contentType: 'html', content: `<p>${body}</p>` },
    // Deliberately different from `body` above, so a test asserting on the
    // full body catches a regression back to preferring bodyPreview (which
    // Graph silently caps at 255 chars).
    bodyPreview: 'Yellow Systems (preview, truncated).',
    from: { emailAddress: { address: from } },
  };
}

function build(
  messages: Array<Record<string, unknown>>,
  delivered = true,
  mailboxes: WorkyMailSubscriptionRecord[] = [SUB],
) {
  const setLastSwept = jest.fn().mockResolvedValue(undefined);
  const subscriptions = {
    listAll: jest.fn().mockResolvedValue(mailboxes),
    setLastSwept,
  };
  const graphClient = { listInboxMessagesSince: jest.fn().mockResolvedValue(messages) };
  const orchestrator = {
    deliverMailReply: jest
      .fn()
      .mockResolvedValue({ delivered, sessionId: 's1', stepId: 'wait' }),
  };
  const turnContext = {
    resolveWorkyAgents: jest.fn().mockResolvedValue([{ id: 'planner-1' }, { id: 'executor-1' }]),
    resolveConnectors: jest.fn().mockResolvedValue([{ connector_id: 'c1' }]),
  };
  const logger = {
    setContext: jest.fn(), log: jest.fn(), warn: jest.fn(),
    error: jest.fn(), debug: jest.fn(),
  };
  const service = new WorkyMailCatchupService(
    subscriptions as never, graphClient as never, orchestrator as never, turnContext as never, logger as never,
  );
  return { service, subscriptions, graphClient, orchestrator, turnContext, logger, setLastSwept };
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

  it('uses the full reply body, not the 255-char-capped bodyPreview', async () => {
    // Live bug: three real replies in a row all came through cut at EXACTLY
    // 255 characters, mid-sentence -- Microsoft Graph's bodyPreview field is
    // a plain-text summary hard-capped at 255 chars, and it was being
    // preferred over the full body.content.
    const longReply = 'A'.repeat(300) + ' END';
    const { service, orchestrator } = build([mail(`Re: Q [${TOKEN}]`, 'x@example.com', longReply)]);
    await service.sweep();

    expect(orchestrator.deliverMailReply).toHaveBeenCalledWith(
      expect.objectContaining({ replyBody: longReply }),
    );
  });

  it('resolves real connectors and agents for the mailbox owner, not none', async () => {
    // Same bug as the webhook path: without this, resume_turn rebuilds every
    // not-yet-run step with ZERO tools -- a step needing one silently
    // fabricates a "done" result instead of actually acting.
    const { service, turnContext, orchestrator } = build([mail(`Re: Q [${TOKEN}]`)]);
    await service.sweep();

    expect(turnContext.resolveWorkyAgents).toHaveBeenCalledWith(SUB.userId);
    expect(turnContext.resolveConnectors).toHaveBeenCalledWith(SUB.userId);
    expect(orchestrator.deliverMailReply).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: [{ id: 'planner-1' }, { id: 'executor-1' }],
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
    const { service, graphClient, setLastSwept } = build([]);
    const before = Date.now();
    await service.sweep();

    const since = graphClient.listInboxMessagesSince.mock.calls[0][2] as Date;
    expect(since.getTime()).toBe(SUB.lastSweptAt!.getTime() - 2 * 60_000);
    expect(graphClient.listInboxMessagesSince).toHaveBeenCalledWith(
      SUB.userId, 'microsoft', expect.any(Date),
    );
    // The cursor moves to the clock read at the start of this sweep.
    expect(setLastSwept).toHaveBeenCalledWith(SUB.id, expect.any(Date));
    expect((setLastSwept.mock.calls[0][1] as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('looks back an hour for a mailbox that was never swept', async () => {
    const { service, graphClient } = build([], true, [{ ...SUB, lastSweptAt: null }]);
    const before = Date.now();
    await service.sweep();

    const since = (graphClient.listInboxMessagesSince.mock.calls[0][2] as Date).getTime();
    expect(since).toBeGreaterThanOrEqual(before - 62 * 60_000);
    expect(since).toBeLessThanOrEqual(Date.now() - 62 * 60_000);
  });

  it('re-reads the window when a delivery throws, instead of skipping it', async () => {
    // The cursor only moves once the whole window delivered. A sweep that dies
    // half way must not step over the replies it never reached — and replaying
    // costs nothing, since a wait can only be claimed once.
    const { service, orchestrator, setLastSwept } = build([mail(`Re: Q [${TOKEN}]`)]);
    orchestrator.deliverMailReply.mockRejectedValueOnce(new Error('grpc down'));

    await service.sweep();
    expect(setLastSwept).not.toHaveBeenCalled();

    orchestrator.deliverMailReply.mockResolvedValue({
      delivered: true, sessionId: 's1', stepId: 'wait',
    });
    await service.sweep(); // the retry gets there, and now commits the cursor
    expect(setLastSwept).toHaveBeenCalledTimes(1);
    expect(setLastSwept).toHaveBeenCalledWith(SUB.id, expect.any(Date));
    expect(orchestrator.deliverMailReply).toHaveBeenCalledTimes(2);
  });

  it('keeps sweeping other mailboxes when one fails', async () => {
    const other: WorkyMailSubscriptionRecord = { ...SUB, id: newObjectId(), userId: newObjectId() };
    const { service, graphClient, logger, setLastSwept } = build([], true, [SUB, other]);
    graphClient.listInboxMessagesSince.mockRejectedValueOnce(new Error('token expired'));
    await expect(service.sweep()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Mail catch-up sweep failed for a mailbox',
      { userId: SUB.userId, error: 'token expired' },
    );
    expect(graphClient.listInboxMessagesSince).toHaveBeenCalledTimes(2);
    expect(setLastSwept).toHaveBeenCalledTimes(1);
    expect(setLastSwept).toHaveBeenCalledWith(other.id, expect.any(Date));
  });
});
