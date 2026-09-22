import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { UserService } from '@modules/user/user.service';
import { EmailService } from '@modules/email';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { ServiceUnavailableException } from '@modules/exceptions';
import { EmailTemplateRenderer } from '@modules/email/email-template-renderer.service';
import { ConversationV2AppShare } from '../schemas/conversation-v2-app-share.schema';
import { ConversationV2Session } from '../schemas/conversation-v2-session.schema';
import { ConversationV2AppShareService } from './conversation-v2-app-share.service';
import { ConversationV2ShareService } from './conversation-v2-share.service';

describe('ConversationV2AppShareService', () => {
  let svc: ConversationV2AppShareService;
  let shareTokens: ConversationV2ShareService;

  const findOneAndUpdate = jest.fn();
  const find = jest.fn();
  const findOne = jest.fn();
  const updateMany = jest.fn().mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 0 }) });
  const sessionFind = jest.fn();
  const sessionFindById = jest.fn();

  const users = { findByEmail: jest.fn(), findById: jest.fn() };
  const email = {
    isAvailable: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue({ success: true }),
  };
  const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
  const emailRenderer = {
    render: jest.fn().mockImplementation(
      (_template: string, data: Record<string, string>) =>
        Promise.resolve({
          subject: `${data.appTitle} — create your account`,
          html: `<p>Invite ${data.appTitle} ${data.registerUrl}</p>`,
          text: `Invite ${data.appTitle} ${data.registerUrl}`,
          attachments: [],
        }),
    ),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'app.name') return 'YelloStorm';
      if (key === 'app.frontendUrl') return 'http://localhost:5173';
      if (key === 'conversationV2.appShareInviteTtlDays') return 7;
      return fallback;
    }),
  };

  function stubShareDocs(docs: unknown[]) {
    find.mockReturnValueOnce({
      sort: () => ({
        lean: () => ({
          exec: () => Promise.resolve(docs),
        }),
      }),
    });
  }

  function stubSessionPointers(pointers: unknown[]) {
    sessionFind.mockReturnValueOnce({
      select: () => ({
        lean: () => ({
          exec: () => Promise.resolve(pointers),
        }),
      }),
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    users.findByEmail.mockReset();
    users.findById.mockReset();
    email.isAvailable.mockReturnValue(true);
    email.send.mockResolvedValue({ success: true });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationV2AppShareService,
        ConversationV2ShareService,
        {
          provide: getModelToken(ConversationV2AppShare.name),
          useValue: { findOneAndUpdate, find, findOne, updateMany },
        },
        {
          provide: getModelToken(ConversationV2Session.name),
          useValue: { find: sessionFind, findById: sessionFindById },
        },
        { provide: UserService, useValue: users },
        { provide: EmailService, useValue: email },
        { provide: NotificationsService, useValue: notifications },
        { provide: EmailTemplateRenderer, useValue: emailRenderer },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    svc = module.get(ConversationV2AppShareService);
    shareTokens = module.get(ConversationV2ShareService);
  });

  it('shareByEmails upserts a share record for known users', async () => {
    const ownerId = new Types.ObjectId();
    const recipientId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const shareId = new Types.ObjectId();
    users.findById.mockResolvedValueOnce({ _id: ownerId, email: 'owner@example.com' });
    users.findByEmail.mockResolvedValueOnce({ _id: recipientId });
    findOneAndUpdate.mockResolvedValueOnce({ _id: shareId });

    await expect(
      svc.shareByEmails({
        ownerId: ownerId.toString(),
        sessionId: sessionId.toString(),
        emails: ['colleague@example.com'],
        title: 'Generated app',
        deployedUrl: 'https://apps.example/a',
        lastDeployedAt: null,
      }),
    ).resolves.toEqual({
      shared: [{ shareId: shareId.toString(), recipientEmail: 'colleague@example.com' }],
      notFound: [],
      skippedSelf: [],
    });
    expect(findOneAndUpdate).toHaveBeenCalled();
    expect(findOneAndUpdate.mock.calls[0][1].$set.includeConversation).toBe(true);
    expect(findOneAndUpdate.mock.calls[0][1].$set.inviteTokenHash).toEqual(expect.any(String));
    expect(findOneAndUpdate.mock.calls[0][1].$set.inviteExpiresAt).toBeInstanceOf(Date);
    expect(findOneAndUpdate.mock.calls[0][1].$set.inviteConsumedAt).toBeNull();
    expect(findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      email.send.mock.invocationCallOrder[0],
    );
    expect(email.send.mock.calls[0][0].html).toContain('/register?invite=');
    expect(email.send.mock.calls[0][0].html).toContain('https://apps.example/a/register?invite=');
    expect(email.send.mock.calls[0][0].html).not.toContain('//register');
    expect(email.send.mock.calls[0][0].html).not.toContain('Open the app');
    expect(email.send.mock.calls[0][0].html).not.toContain('App Builder');
    expect(email.send.mock.calls[0][0].text).not.toContain('Conversation:');
  });

  it('shareByEmails persists then throws when email delivery fails', async () => {
    const ownerId = new Types.ObjectId();
    const recipientId = new Types.ObjectId();
    const shareId = new Types.ObjectId();
    users.findById.mockResolvedValueOnce({ _id: ownerId, email: 'owner@example.com' });
    users.findByEmail.mockResolvedValueOnce({ _id: recipientId });
    findOneAndUpdate.mockResolvedValueOnce({ _id: shareId });
    email.send.mockResolvedValueOnce({ success: false });

    await expect(
      svc.shareByEmails({
        ownerId: ownerId.toString(),
        sessionId: new Types.ObjectId().toString(),
        emails: ['colleague@example.com'],
        title: 'Generated app',
        deployedUrl: 'https://apps.example/a',
        lastDeployedAt: null,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(findOneAndUpdate).toHaveBeenCalled();
    expect(email.send).toHaveBeenCalled();
  });

  it('shareByEmails invites unknown recipients by email', async () => {
    const ownerId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const shareId = new Types.ObjectId();
    users.findById.mockResolvedValue({ _id: ownerId, email: 'owner@example.com' });
    users.findByEmail.mockResolvedValue(null);
    findOneAndUpdate.mockResolvedValue({ _id: shareId });

    await expect(
      svc.shareByEmails({
        ownerId: ownerId.toString(),
        sessionId: sessionId.toString(),
        emails: ['missing@example.com'],
        title: 'App',
        deployedUrl: 'https://apps.example/a',
        lastDeployedAt: null,
      }),
    ).resolves.toEqual({
      shared: [{ shareId: shareId.toString(), recipientEmail: 'missing@example.com' }],
      notFound: [],
      skippedSelf: [],
    });
    expect(findOneAndUpdate).toHaveBeenCalled();
    expect(findOneAndUpdate.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ recipientEmail: 'missing@example.com' }),
    );
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('listSharedWithUser treats legacy shares without includeConversation as conversation-enabled', async () => {
    const sessionId = new Types.ObjectId();
    const shareId = new Types.ObjectId();
    stubShareDocs([
      {
        _id: shareId,
        sessionId,
        title: 'Legacy shared app',
        deployedUrl: 'https://apps.example/legacy',
        lastDeployedAt: null,
      },
    ]);
    stubSessionPointers([]);

    await expect(svc.listSharedWithUser(new Types.ObjectId().toString())).resolves.toEqual([
      expect.objectContaining({
        sessionId: sessionId.toString(),
        canOpenConversation: true,
      }),
    ]);
  });

  it('listSharedWithUser maps share docs for Marketplace', async () => {
    const sessionId = new Types.ObjectId();
    const shareId = new Types.ObjectId();
    stubShareDocs([
      {
        _id: shareId,
        sessionId,
        title: 'Shared app',
        deployedUrl: 'https://apps.example/shared',
        lastDeployedAt: new Date('2026-07-16T10:00:00.000Z'),
        includeConversation: true,
      },
    ]);
    stubSessionPointers([]);

    await expect(svc.listSharedWithUser(new Types.ObjectId().toString())).resolves.toEqual([
      {
        sessionId: sessionId.toString(),
        title: 'Shared app',
        deployedUrl: 'https://apps.example/shared',
        lastDeployedAt: '2026-07-16T10:00:00.000Z',
        source: 'shared',
        shareId: shareId.toString(),
        canOpenConversation: true,
        hasAiFeatures: false,
        lastDeployedRevisionId: null,
        latestFinalizedRevisionId: null,
        latestFinalizedAt: null,
        finalizedVersionCount: 0,
      },
    ]);
  });

  it('listSharedWithUser resolves the live deployed title when the share snapshot is stale', async () => {
    const sessionId = new Types.ObjectId();
    const shareId = new Types.ObjectId();
    stubShareDocs([
      {
        _id: shareId,
        sessionId,
        title: 'Untitled app',
        deployedUrl: 'https://apps.example/shared',
        lastDeployedAt: null,
        includeConversation: true,
      },
    ]);
    stubSessionPointers([
      { _id: sessionId, title: 'Old conversation name', deployedAppTitle: 'Live deployed title' },
    ]);

    await expect(svc.listSharedWithUser(new Types.ObjectId().toString())).resolves.toEqual([
      expect.objectContaining({ title: 'Live deployed title' }),
    ]);
  });

  it('listSharedWithUser falls back to the live session title when no deployed title exists', async () => {
    const sessionId = new Types.ObjectId();
    const shareId = new Types.ObjectId();
    stubShareDocs([
      {
        _id: shareId,
        sessionId,
        title: 'Untitled app',
        deployedUrl: 'https://apps.example/shared',
        lastDeployedAt: null,
        includeConversation: true,
      },
    ]);
    stubSessionPointers([
      { _id: sessionId, title: 'Task Manager', deployedAppTitle: null },
    ]);

    await expect(svc.listSharedWithUser(new Types.ObjectId().toString())).resolves.toEqual([
      expect.objectContaining({ title: 'Task Manager' }),
    ]);
  });

  it('listSharedWithUser keeps the snapshot title when the session has no live title', async () => {
    const sessionId = new Types.ObjectId();
    const shareId = new Types.ObjectId();
    stubShareDocs([
      {
        _id: shareId,
        sessionId,
        title: 'Shared app',
        deployedUrl: 'https://apps.example/shared',
        lastDeployedAt: null,
        includeConversation: true,
      },
    ]);
    stubSessionPointers([{ _id: sessionId, title: '', deployedAppTitle: null }]);

    await expect(svc.listSharedWithUser(new Types.ObjectId().toString())).resolves.toEqual([
      expect.objectContaining({ title: 'Shared app' }),
    ]);
  });

  it('resolveInviteToken returns invite metadata for a live token', async () => {
    const { token, hash } = shareTokens.issue();
    const sessionId = new Types.ObjectId();
    const expiresAt = new Date(Date.now() + 86_400_000);
    findOne.mockReturnValueOnce({
      lean: () => ({
        exec: () =>
          Promise.resolve({
            recipientEmail: 'guest@example.com',
            inviteExpiresAt: expiresAt,
            inviteConsumedAt: null,
            sessionId,
            title: 'Shared app',
            deployedUrl: 'https://apps.example/a/',
          }),
      }),
    });
    sessionFindById.mockReturnValueOnce({
      lean: () => ({
        exec: () => Promise.resolve({ aiSessionId: 'ws-1', title: 'Live title' }),
      }),
    });

    await expect(svc.resolveInviteToken(token)).resolves.toEqual({
      email: 'guest@example.com',
      appTitle: 'Live title',
      deployedUrl: 'https://apps.example/a/',
      sessionId: sessionId.toString(),
      workspaceId: 'ws-1',
      expiresAt,
      consumed: false,
    });
    expect(findOne).toHaveBeenCalledWith({ inviteTokenHash: hash });
  });

  it('resolveInviteToken returns null for a blank token', async () => {
    await expect(svc.resolveInviteToken('  ')).resolves.toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('consumeInviteToken marks a matching live invite as consumed', async () => {
    const { token } = shareTokens.issue();
    const save = jest.fn().mockResolvedValue(undefined);
    findOne.mockReturnValueOnce({
      exec: () =>
        Promise.resolve({
          recipientEmail: 'guest@example.com',
          inviteExpiresAt: new Date(Date.now() + 86_400_000),
          inviteConsumedAt: null,
          save,
        }),
    });

    await expect(svc.consumeInviteToken(token, 'guest@example.com')).resolves.toBe(true);
    expect(save).toHaveBeenCalled();
  });

  it('consumeInviteToken is idempotent when already consumed by the same email', async () => {
    const { token } = shareTokens.issue();
    const save = jest.fn();
    findOne.mockReturnValueOnce({
      exec: () =>
        Promise.resolve({
          recipientEmail: 'guest@example.com',
          inviteExpiresAt: new Date(Date.now() + 86_400_000),
          inviteConsumedAt: new Date(),
          save,
        }),
    });

    await expect(svc.consumeInviteToken(token, 'guest@example.com')).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('consumeInviteToken rejects expired or mismatched emails', async () => {
    const { token } = shareTokens.issue();
    findOne.mockReturnValueOnce({
      exec: () =>
        Promise.resolve({
          recipientEmail: 'guest@example.com',
          inviteExpiresAt: new Date(Date.now() - 1000),
          inviteConsumedAt: null,
          save: jest.fn(),
        }),
    });
    await expect(svc.consumeInviteToken(token, 'guest@example.com')).resolves.toBe(false);

    findOne.mockReturnValueOnce({
      exec: () =>
        Promise.resolve({
          recipientEmail: 'guest@example.com',
          inviteExpiresAt: new Date(Date.now() + 86_400_000),
          inviteConsumedAt: null,
          save: jest.fn(),
        }),
    });
    await expect(svc.consumeInviteToken(token, 'other@example.com')).resolves.toBe(false);
  });
});
