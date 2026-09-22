import { ShareService } from './share.service';
import type { EmbeddedMessage } from '../interfaces/share.interface';
import type { MessageComponent } from '../interfaces/message.interface';

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
];

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
    findSourceConversation: jest.fn().mockResolvedValue({
      id: 'conversation-1',
      title: 'Shared title',
      createdBy: 'user-1',
      workspaceIds: ['workspace-1'],
      memberIds: [],
    }),
    listSnapshotMessages: jest.fn().mockResolvedValue([]),
    createPublic: jest.fn(),
    forkConversation: jest.fn(),
    addConversationMembers: jest.fn().mockResolvedValue(['recipient-1']),
    removeConversationMembers: jest.fn().mockResolvedValue(undefined),
    deleteForkConversations: jest.fn().mockResolvedValue(undefined),
    createPrivate: jest.fn(),
    listForConversation: jest.fn(),
    findById: jest.fn(),
    markRevoked: jest.fn(),
    findPublicByToken: jest.fn(),
    incrementViewCount: jest.fn(),
    ...overrides,
  };
  const userService = {
    findByEmail: jest.fn().mockResolvedValue({ _id: { toString: () => 'recipient-1' } }),
  };
  const emailService = { sendBulk: jest.fn().mockResolvedValue({ failed: 0 }) };
  const workspaceService = {
    findById: jest.fn().mockResolvedValue({
      id: 'workspace-1',
      createdBy: 'user-1',
      isSystem: false,
      isPublic: false,
    }),
  };
  const workspaceShareService = {
    hasAccess: jest.fn().mockResolvedValue(false),
    share: jest.fn().mockResolvedValue({ shared: [{ id: 'workspace-share-1' }] }),
  };
  const service = new ShareService(
    store as never,
    {
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'app.frontendUrl' ? 'https://app.example.test' : (fallback ?? 30),
      ),
    } as never,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
    userService as never,
    emailService as never,
    workspaceService as never,
    workspaceShareService as never,
  );
  return { service, store, userService, emailService, workspaceShareService };
}

describe('ShareService', () => {
  it('removes internal components before persisting a public share snapshot', async () => {
    const unknownComponent = {
      id: 'debug',
      type: 'debug',
      data: { content: 'Internal debug payload' },
    } as unknown as MessageComponent;
    const { service, store } = createService({
      listSnapshotMessages: jest.fn().mockResolvedValue([
        {
          conversationType: 'ai',
          content: 'Internal instructions',
          components: [...components, unknownComponent],
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
    ]);
    expect(snapshot[0].content).toBeUndefined();
  });

  it('grants registered users access to the live conversation and referenced workspaces', async () => {
    const { service, store, emailService, workspaceShareService } = createService({
      createPrivate: jest.fn().mockResolvedValue(
        share({ shareType: 'private', accessToken: undefined, recipientEmails: ['person@example.com'] }),
      ),
    });

    const result = await service.createShare('user-1', {
      conversationId: 'conversation-1',
      shareType: 'private',
      recipientEmails: ['person@example.com'],
      shareWorkspaces: true,
    });

    expect(store.addConversationMembers).toHaveBeenCalledWith(
      'conversation-1',
      ['recipient-1'],
      expect.any(Date),
    );
    expect(store.listSnapshotMessages).toHaveBeenCalledWith('conversation-1', 40);
    expect(store.forkConversation).not.toHaveBeenCalled();
    expect(workspaceShareService.share).toHaveBeenCalledWith('workspace-1', 'user-1', {
      shares: [{ email: 'person@example.com', permission: 'read' }],
    });
    expect(emailService.sendBulk).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: [expect.objectContaining({ text: expect.stringContaining('/#/conversation/conversation-1') })],
      }),
    );
    expect(result).toMatchObject({ sharedWorkspaceCount: 1, notFound: [], invalid: [] });
  });

  it('adds a recipient only once when the same account is selected twice', async () => {
    const { service, store } = createService({
      createPrivate: jest.fn().mockResolvedValue(
        share({ shareType: 'private', recipientUserIds: ['recipient-1'] }),
      ),
    });

    const result = await service.createShare('user-1', {
      conversationId: 'conversation-1',
      shareType: 'private',
      recipientEmails: ['person@example.com', 'PERSON@example.com'],
    });

    expect(store.addConversationMembers).toHaveBeenCalledWith(
      'conversation-1',
      ['recipient-1'],
      expect.any(Date),
    );
    expect(result.invalid).toEqual(['PERSON@example.com']);
  });

  it('does not downgrade an existing workspace grant', async () => {
    const { service, store, workspaceShareService } = createService({
      createPrivate: jest.fn().mockResolvedValue(share({ shareType: 'private', accessToken: undefined })),
    });
    workspaceShareService.hasAccess.mockResolvedValue(true);

    const result = await service.createShare('user-1', {
      conversationId: 'conversation-1',
      shareType: 'private',
      recipientEmails: ['person@example.com'],
      shareWorkspaces: true,
    });

    expect(workspaceShareService.share).not.toHaveBeenCalled();
    expect(result.sharedWorkspaceCount).toBe(0);
    expect(store.addConversationMembers).toHaveBeenCalled();
  });

  it('rejects self-sharing and unknown recipients when nobody is eligible', async () => {
    const { service, userService, store } = createService();
    userService.findByEmail
      .mockResolvedValueOnce({ _id: { toString: () => 'user-1' } })
      .mockResolvedValueOnce(null);

    await expect(
      service.createShare('user-1', {
        conversationId: 'conversation-1',
        shareType: 'private',
        recipientEmails: ['me@example.com', 'missing@example.com'],
      }),
    ).rejects.toMatchObject({ response: 'No eligible registered recipients were selected' });
    expect(store.createPrivate).not.toHaveBeenCalled();
  });

  it('does not let a conversation member reshare it', async () => {
    const { service, store } = createService({
      findSourceConversation: jest.fn().mockResolvedValue({
        id: 'conversation-1',
        title: 'Shared title',
        createdBy: 'user-1',
        workspaceIds: [],
        memberIds: ['member-1'],
      }),
    });

    await expect(
      service.createShare('member-1', {
        conversationId: 'conversation-1',
        shareType: 'private',
        recipientEmails: ['person@example.com'],
      }),
    ).rejects.toMatchObject({ response: 'Only the conversation owner can share it' });
    expect(store.addConversationMembers).not.toHaveBeenCalled();
  });

  it('does not expose share recipients to conversation members', async () => {
    const { service, store } = createService({
      findSourceConversation: jest.fn().mockResolvedValue({
        id: 'conversation-1',
        title: 'Shared title',
        createdBy: 'user-1',
        workspaceIds: [],
        memberIds: ['member-1'],
      }),
    });

    await expect(
      service.getSharesForConversation('conversation-1', 'member-1'),
    ).rejects.toMatchObject({ response: 'Only the conversation owner can view its shares' });
    expect(store.listForConversation).not.toHaveBeenCalled();
  });

  it('does not remove members when a legacy private share is revoked', async () => {
    const { service, store } = createService({
      findById: jest.fn().mockResolvedValue(
        share({ shareType: 'private', recipientEmails: ['person@example.com'] }),
      ),
    });

    await service.revokeShare('share-1', 'user-1');

    expect(store.removeConversationMembers).not.toHaveBeenCalled();
    expect(store.markRevoked).toHaveBeenCalledWith('share-1');
  });

  it('removes direct recipients when a new private share is revoked', async () => {
    const { service, store } = createService({
      findById: jest.fn().mockResolvedValue(
        share({ shareType: 'private', recipientUserIds: ['recipient-1'] }),
      ),
    });

    await service.revokeShare('share-1', 'user-1');

    expect(store.removeConversationMembers).toHaveBeenCalledWith('conversation-1', ['recipient-1']);
  });

  it('does not increment expired public shares', async () => {
    const { service, store } = createService({
      findPublicByToken: jest.fn().mockResolvedValue(
        share({ expiresAt: new Date(Date.now() - 1_000) }),
      ),
    });

    await expect(service.viewPublicShare('token')).rejects.toMatchObject({
      response: 'This shared conversation link has expired',
    });
    expect(store.incrementViewCount).not.toHaveBeenCalled();
  });
});
