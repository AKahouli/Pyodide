import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { UserService } from '@modules/user/user.service';
import { EmailService } from '@modules/email';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ConversationV2AppShare } from '../schemas/conversation-v2-app-share.schema';
import { ConversationV2Session } from '../schemas/conversation-v2-session.schema';
import { ConversationV2AppShareService } from './conversation-v2-app-share.service';

describe('ConversationV2AppShareService', () => {
  let svc: ConversationV2AppShareService;

  const findOneAndUpdate = jest.fn();
  const find = jest.fn();
  const updateMany = jest.fn().mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 0 }) });
  const sessionFind = jest.fn();

  const users = { findByEmail: jest.fn(), findById: jest.fn() };
  const email = {
    isAvailable: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue({ success: true }),
  };
  const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'app.name') return 'YelloStorm';
      if (key === 'app.frontendUrl') return 'http://localhost:5173';
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
        {
          provide: getModelToken(ConversationV2AppShare.name),
          useValue: { findOneAndUpdate, find, updateMany },
        },
        {
          provide: getModelToken(ConversationV2Session.name),
          useValue: { find: sessionFind },
        },
        { provide: UserService, useValue: users },
        { provide: EmailService, useValue: email },
        { provide: NotificationsService, useValue: notifications },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    svc = module.get(ConversationV2AppShareService);
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
    expect(email.send.mock.invocationCallOrder[0]).toBeLessThan(
      findOneAndUpdate.mock.invocationCallOrder[0],
    );
  });

  it('shareByEmails does not persist share when email delivery fails', async () => {
    const ownerId = new Types.ObjectId();
    const recipientId = new Types.ObjectId();
    users.findById.mockResolvedValueOnce({ _id: ownerId, email: 'owner@example.com' });
    users.findByEmail.mockResolvedValueOnce({ _id: recipientId });
    email.send.mockResolvedValueOnce({ success: false });

    await expect(
      svc.shareByEmails({
        ownerId: new Types.ObjectId().toString(),
        sessionId: new Types.ObjectId().toString(),
        emails: ['colleague@example.com'],
        title: 'Generated app',
        deployedUrl: 'https://apps.example/a',
        lastDeployedAt: null,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(findOneAndUpdate).not.toHaveBeenCalled();
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
});
