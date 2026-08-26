import { WorkyTeamsCatchupService } from './worky-teams-catchup.service';

function build(opts: {
  waits?: Array<{ chatId: string; userId: string; sessionId: string }>;
  messages?: Array<Record<string, any>>;
  myId?: string;
  delivered?: boolean;
}) {
  const orchestrator = {
    listOpenChatWaits: jest.fn().mockResolvedValue(opts.waits ?? []),
    deliverChatReply: jest.fn().mockResolvedValue({
      delivered: opts.delivered ?? true,
      sessionId: 's1',
      stepId: 'step-1',
    }),
  };
  const graphClient = {
    getMyId: jest.fn().mockResolvedValue(opts.myId ?? 'me-id'),
    listChatMessagesSince: jest.fn().mockResolvedValue(opts.messages ?? []),
  };
  const turnContext = {
    resolveWorkyAgents: jest.fn().mockResolvedValue([{ id: 'a' }]),
    resolveConnectors: jest.fn().mockResolvedValue([{ id: 'c' }]),
  };
  const logger = {
    setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  };
  const service = new WorkyTeamsCatchupService(
    graphClient as any, orchestrator as any, turnContext as any, logger as any,
  );
  return { service, orchestrator, graphClient, turnContext, logger };
}

const human = (id: string, content: string, name = 'Rabeb') => ({
  from: { user: { id, displayName: name } },
  body: { contentType: 'text', content },
  createdDateTime: new Date().toISOString(),
});

describe('WorkyTeamsCatchupService', () => {
  it('forwards a human reply to the waiting step via deliverChatReply', async () => {
    const { service, orchestrator } = build({
      waits: [{ chatId: '19:abc@thread.v2', userId: 'u1', sessionId: 's1' }],
      messages: [human('human-id', 'yes, approved')],
      myId: 'me-id',
    });

    await service.sweep();

    expect(orchestrator.deliverChatReply).toHaveBeenCalledTimes(1);
    expect(orchestrator.deliverChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '19:abc@thread.v2',
        replyBody: 'yes, approved',
        replyFrom: 'Rabeb',
        agents: [{ id: 'a' }],
        connectors: [{ id: 'c' }],
      }),
    );
  });

  it("never feeds worky's OWN outgoing message back as the reply", async () => {
    const { service, orchestrator } = build({
      waits: [{ chatId: '19:abc@thread.v2', userId: 'u1', sessionId: 's1' }],
      // Only our own message is in the chat so far — no human reply yet.
      messages: [human('me-id', 'Should we ship? [our outgoing question]')],
      myId: 'me-id',
    });

    await service.sweep();

    expect(orchestrator.deliverChatReply).not.toHaveBeenCalled();
  });

  it('stops after a reply is claimed (does not re-deliver older messages)', async () => {
    const { service, orchestrator } = build({
      waits: [{ chatId: '19:abc@thread.v2', userId: 'u1', sessionId: 's1' }],
      messages: [human('human-id', 'the real reply'), human('human-id', 'an older message')],
      myId: 'me-id',
      delivered: true,
    });

    await service.sweep();

    expect(orchestrator.deliverChatReply).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no chats are open', async () => {
    const { service, graphClient, orchestrator } = build({ waits: [] });
    await service.sweep();
    expect(graphClient.getMyId).not.toHaveBeenCalled();
    expect(orchestrator.deliverChatReply).not.toHaveBeenCalled();
  });

  it('resolves per-user context once even across several open chats', async () => {
    const { service, graphClient } = build({
      waits: [
        { chatId: '19:one@thread.v2', userId: 'u1', sessionId: 's1' },
        { chatId: '19:two@thread.v2', userId: 'u1', sessionId: 's2' },
      ],
      messages: [],
      myId: 'me-id',
    });

    await service.sweep();

    // Same user for both chats → own-id and agents/connectors resolved once.
    expect(graphClient.getMyId).toHaveBeenCalledTimes(1);
    expect(graphClient.listChatMessagesSince).toHaveBeenCalledTimes(2);
  });
});
