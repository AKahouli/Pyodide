import { ShareService } from './share.service';
import type { EmbeddedMessage } from '../interfaces/share.interface';
import type { MessageComponent } from '../interfaces/message.interface';
import { ConversationCloneLimitError } from '../persistence/share-store';

const now = new Date('2026-07-15T10:00:00.000Z');
const components: MessageComponent[] = [
  {
    id: 'activity',
    type: 'agentActivity',
    data: { summary: 'Preparing answer', detail: 'Private reasoning', status: 'completed' },
  },
  {
    id: 'tool',
    type: 'toolActivity',
    data: {
      toolName: 'activate_skill',
      paramsJson: '{"secret":"value"}',
      resultJson: '{"private":true}',
    },
  },
  {
    id: 'artifact',
    type: 'artifact',
    data: { artifactId: 'artifact-1', filename: 'private.pdf', storagePath: 'private.pdf' },
  },
  {
    id: 'task',
    type: 'task',
    data: { title: 'Smart Agent', items: ['Raw private context'], status: 'completed' },
  },
  { id: 'answer', type: 'text', data: { content: 'Public answer' } },
  { id: 'choice', type: 'choice', data: { prompt: 'Continue?' } },
];
const unknownComponent = {
  id: 'debug',
  type: 'debug',
  data: { content: 'Internal debug payload' },
} as unknown as MessageComponent;

function share(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    originalConversationId: 'conversation-1',
    sharedBy: 'user-1',
    shareType: 'public',
    title: 'Shared title',
    messages: [] as EmbeddedMessage[],
    accessToken: 'token',
    viewCount: 0,
    isRevoked: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createService(overrides: Record<string, jest.Mock> = {}) {
  const store = {
    findSourceConversation: jest
      .fn()
      .mockResolvedValue({ id: 'conversation-1', title: 'Shared title' }),
    listSnapshotMessages: jest.fn().mockResolvedValue([]),
    createPublic: jest.fn(),
    forkConversation: jest.fn(),
    deleteForkConversations: jest.fn().mockResolvedValue(undefined),
    createPrivate: jest.fn(),
    listForConversation: jest.fn(),
    findById: jest.fn(),
    markRevoked: jest.fn(),
    findPublicByToken: jest.fn(),
    incrementViewCount: jest.fn(),
    ...overrides,
  };
  const userService = { findByEmail: jest.fn().mockResolvedValue({ _id: { toString: () => 'recipient-1' } }) };
  const emailService = { sendBulk: jest.fn().mockResolvedValue({ failed: 0 }) };
  const service = new ShareService(
    store as never,
    { get: jest.fn((key: string, fallback: unknown) => key === 'app.frontendUrl' ? 'https://app.example.test' : fallback ?? 30) } as never,
    { setContext: jest.fn(), log: jest.fn(), error: jest.fn() } as never,
    userService as never,
    emailService as never,
  );
  return { service, store, userService, emailService };
}

describe('ShareService', () => {
  it('removes internal components before persisting a public share snapshot', async () => {
    const { service, store } = createService({
      listSnapshotMessages: jest.fn().mockResolvedValue([
        {
          conversationType: 'ai',
          content: 'Internal instructions',
          components: [...components, unknownComponent],
          modelId: 'model-1',
          createdAt: now,
        },
      ]),
      createPublic: jest.fn().mockResolvedValue(share()),
    });

    await service.createShare('user-1', {
      conversationId: 'conversation-1',
      shareType: 'public',
    });

    const snapshot = store.createPublic.mock.calls[0][0].messages as EmbeddedMessage[];
    expect(snapshot[0].components).toEqual([
      { ...components[0], data: { summary: 'Preparing answer', status: 'completed' } },
      { ...components[1], data: { toolName: 'activate_skill' } },
      { ...components[3], data: { ...components[3].data, items: [] } },
      components[4],
      components[5],
    ]);
    expect(snapshot[0].content).toBeUndefined();
  });

  it('removes internal components from legacy snapshots without mutating them', async () => {
    const legacyMessages: EmbeddedMessage[] = [
      {
        conversationType: 'ai',
        content: 'Internal instructions',
        components: [...components, unknownComponent],
        modelId: 'model-1',
        createdAt: now,
      },
      { conversationType: 'user', content: 'Hello', createdAt: now },
    ];
    const { service, store } = createService({
      findPublicByToken: jest.fn().mockResolvedValue(share({ messages: legacyMessages })),
      incrementViewCount: jest.fn().mockResolvedValue(4),
    });

    const result = await service.viewPublicShare('token');

    expect(result.messages[0].content).toBeUndefined();
    expect(result.messages[1]).toEqual(legacyMessages[1]);
    expect(result.viewCount).toBe(4);
    expect(store.incrementViewCount).toHaveBeenCalledWith('share-1');
    expect(legacyMessages[0].components).toEqual([...components, unknownComponent]);
  });

  it('creates recipient-owned copies and emails their conversation links', async () => {
    const { service, store, emailService } = createService({
      forkConversation: jest
        .fn()
        .mockResolvedValueOnce('fork-1')
        .mockResolvedValueOnce('fork-2'),
      createPrivate: jest
        .fn()
        .mockResolvedValue(share({ shareType: 'private', accessToken: undefined })),
    });

    await service.createShare('user-1', {
      conversationId: 'conversation-1',
      shareType: 'private',
      recipientEmails: ['one@example.com', 'two@example.com'],
    });

    expect(store.createPrivate).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmails: ['one@example.com', 'two@example.com'],
        forkedConversationIds: ['fork-1', 'fork-2'],
      }),
    );
    expect(store.forkConversation).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'recipient-1', sharedBy: 'user-1' }));
    expect(emailService.sendBulk).toHaveBeenCalledWith(expect.objectContaining({
      emails: expect.arrayContaining([
        expect.objectContaining({ to: 'one@example.com', text: expect.stringContaining('/#/conversation/fork-1') }),
        expect.objectContaining({ to: 'two@example.com', text: expect.stringContaining('/#/conversation/fork-2') }),
      ]),
    }));
  });

  it('deletes committed forks when a later recipient exceeds the clone limit', async () => {
    const { service, store } = createService({
      forkConversation: jest
        .fn()
        .mockResolvedValueOnce('fork-1')
        .mockRejectedValueOnce(new ConversationCloneLimitError('clone limit')),
    });

    await expect(
      service.createShare('user-1', {
        conversationId: 'conversation-1',
        shareType: 'private',
        recipientEmails: ['one@example.com', 'two@example.com'],
      }),
    ).rejects.toMatchObject({ message: 'clone limit' });

    expect(store.deleteForkConversations).toHaveBeenCalledWith(['fork-1']);
    expect(store.createPrivate).not.toHaveBeenCalled();
  });

  it('deletes recipient copies when an invitation email fails', async () => {
    const { service, store, emailService } = createService({
      forkConversation: jest.fn().mockResolvedValue('fork-1'),
    });
    emailService.sendBulk.mockResolvedValue({ failed: 1 });

    await expect(service.createShare('user-1', {
      conversationId: 'conversation-1',
      shareType: 'private',
      recipientEmails: ['one@example.com'],
    })).rejects.toMatchObject({ response: 'Failed to send one or more conversation share emails' });

    expect(store.deleteForkConversations).toHaveBeenCalledWith(['fork-1']);
    expect(store.createPrivate).not.toHaveBeenCalled();
  });

  it('does not increment expired public shares', async () => {
    const { service, store } = createService({
      findPublicByToken: jest
        .fn()
        .mockResolvedValue(share({ expiresAt: new Date(Date.now() - 1_000) })),
    });

    await expect(service.viewPublicShare('token')).rejects.toMatchObject({
      response: 'This shared conversation link has expired',
    });
    expect(store.incrementViewCount).not.toHaveBeenCalled();
  });
});
