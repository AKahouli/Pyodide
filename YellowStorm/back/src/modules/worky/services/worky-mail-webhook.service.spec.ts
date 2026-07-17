import { WorkyMailWebhookService } from './worky-mail-webhook.service';
import { extractMailToken } from './worky-mail-token';

const TOKEN = 'YW-abcdefghijklmnop1234';
const SUBSCRIPTION = {
  userId: 'u1',
  mailboxAppKey: 'microsoft',
  subscriptionId: 'sub-1',
  clientState: 'secret-abc',
};

function mailWith(subject: string, body: string) {
  return {
    subject,
    body: { content: body },
    bodyPreview: 'Yellow Systems.',
    from: { emailAddress: { address: 'rabeb@example.com' } },
  };
}

function build(overrides: {
  message?: Record<string, unknown> | null;
  delivered?: boolean;
  subscription?: Record<string, unknown> | null;
}) {
  const subscriptions = {
    findByClientState: jest
      .fn()
      .mockResolvedValue(
        overrides.subscription === undefined ? SUBSCRIPTION : overrides.subscription,
      ),
  };
  const graphClient = {
    getMessageByResource: jest
      .fn()
      .mockResolvedValue(
        overrides.message === undefined ? mailWith(`Re: Q [${TOKEN}]`, '<p>hi</p>') : overrides.message,
      ),
  };
  const orchestrator = {
    deliverMailReply: jest.fn().mockResolvedValue({
      delivered: overrides.delivered ?? true,
      sessionId: 's1',
      stepId: 'wait',
    }),
  };
  const logger = {
    setContext: jest.fn(), log: jest.fn(), warn: jest.fn(),
    error: jest.fn(), debug: jest.fn(),
  };
  const service = new WorkyMailWebhookService(
    subscriptions as any, graphClient as any, orchestrator as any, logger as any,
  );
  return { service, subscriptions, graphClient, orchestrator, logger };
}

const notification = (over: Record<string, unknown> = {}) => ({
  value: [{
    subscriptionId: 'sub-1',
    clientState: 'secret-abc',
    resource: "me/messages/AAA",
    resourceData: { id: 'AAA' },
    ...over,
  }],
});

describe('WorkyMailWebhookService', () => {
  it('hands a reply carrying a routing token to the waiting step', async () => {
    const { service, orchestrator } = build({});
    const result = await service.handleNotifications(notification());

    expect(result).toEqual({ handled: 1 });
    expect(orchestrator.deliverMailReply).toHaveBeenCalledWith({
      token: TOKEN,
      replyBody: 'Yellow Systems.',
      replyFrom: 'rabeb@example.com',
    });
  });

  it('ignores mail that carries no token — the usual case', async () => {
    // A mailbox subscription fires for every arriving mail, not just ours, so
    // this path is walked constantly and must be silent.
    const { service, orchestrator, logger } = build({
      message: mailWith('Lunch?', '<p>are you free</p>'),
    });
    const result = await service.handleNotifications(notification());

    expect(result).toEqual({ handled: 0 });
    expect(orchestrator.deliverMailReply).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('rejects a notification whose subscription id does not match its secret', async () => {
    const { service, orchestrator, logger } = build({});
    const result = await service.handleNotifications(
      notification({ subscriptionId: 'someone-elses-sub' }),
    );

    expect(result).toEqual({ handled: 0 });
    expect(orchestrator.deliverMailReply).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('ignores a notification with an unknown clientState', async () => {
    const { service, graphClient } = build({ subscription: null });
    const result = await service.handleNotifications(notification({ clientState: 'guessed' }));

    expect(result).toEqual({ handled: 0 });
    // Never fetch mail on behalf of a subscription we cannot vouch for.
    expect(graphClient.getMessageByResource).not.toHaveBeenCalled();
  });

  it('reports a duplicate delivery as not handled rather than failing', async () => {
    // Graph retries anything it thinks failed; worky answers delivered=false.
    const { service, logger } = build({ delivered: false });
    const result = await service.handleNotifications(notification());

    expect(result).toEqual({ handled: 0 });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps processing the batch when one notification throws', async () => {
    // One poisoned notification must not cost us the others, nor the ack.
    const { service, graphClient, orchestrator } = build({});
    graphClient.getMessageByResource
      .mockRejectedValueOnce(new Error('graph exploded'))
      .mockResolvedValueOnce(mailWith(`Re: Q [${TOKEN}]`, '<p>hi</p>'));

    const two = { value: [notification().value[0], notification().value[0]] };
    const result = await service.handleNotifications(two);

    expect(result).toEqual({ handled: 1 });
    expect(orchestrator.deliverMailReply).toHaveBeenCalledTimes(1);
  });
});

describe('extractMailToken', () => {
  it('finds the token in a Re: subject and in a quoted body', () => {
    expect(extractMailToken(`Re: Which company? [${TOKEN}]`)).toBe(TOKEN);
    expect(
      extractMailToken('rewritten subject', `<blockquote><span>${TOKEN}</span></blockquote>`),
    ).toBe(TOKEN);
  });

  it('returns null for unrelated mail', () => {
    expect(extractMailToken('Lunch?', '<p>are you free</p>')).toBeNull();
    expect(extractMailToken(null, undefined)).toBeNull();
  });
});
