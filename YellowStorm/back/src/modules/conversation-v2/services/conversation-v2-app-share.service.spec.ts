import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UserService } from '@modules/user/user.service';
import { EmailService } from '@modules/email';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { ServiceUnavailableException } from '@modules/exceptions';
import { EmailTemplateRenderer } from '@modules/email/email-template-renderer.service';
import { ConversationV2AppShareService } from './conversation-v2-app-share.service';
import { ConversationV2ShareService } from './conversation-v2-share.service';
import {
  type ConversationV2AppShareRecord, 
  type ConversationV2AppShareStore, 
} from '../persistence/conversation-v2-app-share.store';
import {
  type ConversationV2SessionRecord, 
  type ConversationV2SessionStore, 
} from '../persistence/conversation-v2-session.store';
import { PgConversationV2AppShareStore } from '../persistence/postgres/pg-conversation-v2-app-share.store';
import { PgConversationV2SessionStore } from '../persistence/postgres/pg-conversation-v2-session.store';

const OWNER_ID = 'a'.repeat(24);
const RECIPIENT_ID = 'b'.repeat(24);
const SESSION_ID = 'c'.repeat(24);
const SHARE_ID = 'd'.repeat(24);

function shareRecord(
  overrides: Partial<ConversationV2AppShareRecord> & Pick<ConversationV2AppShareRecord, 'id'>,
): ConversationV2AppShareRecord {
  return {
    sessionId: SESSION_ID,
    ownerId: OWNER_ID,
    recipientUserId: null,
    recipientEmail: null,
    title: 'App',
    deployedUrl: 'https://apps.example/a',
    lastDeployedAt: null,
    includeConversation: true,
    inviteTokenHash: null,
    inviteExpiresAt: null,
    inviteConsumedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function sessionRecord(
  overrides: Partial<ConversationV2SessionRecord> & Pick<ConversationV2SessionRecord, 'id'>,
): ConversationV2SessionRecord {
  return {
    ownerId: OWNER_ID,
    aiSessionId: null,
    title: '',
    status: 'active',
    lastEventAt: new Date(0),
    isShared: false,
    shareTokenHash: null,
    deletedAt: null,
    deployStatus: 'idle',
    deployedUrl: null,
    deployedAppTitle: null,
    lastDeployedAt: null,
    lastDeployedRevisionId: null,
    hasAiFeatures: false,
    aiFeaturesCheckedRevisionId: null,
    workspaceIds: [],
    selectedSkillIds: [],
    selectedConnectorIds: [],
    eventSequence: 0,
    eventCount: 0,
    systemWorkspaceId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe('ConversationV2AppShareService', () => {
  let svc: ConversationV2AppShareService;
  let shareTokens: ConversationV2ShareService;

  const shares: jest.Mocked<Pick<
    ConversationV2AppShareStore,
    | 'upsertByRecipientUser'
    | 'upsertByRecipientEmail'
    | 'listByRecipientUserId'
    | 'findByInviteTokenHash'
    | 'markInviteConsumed'
    | 'claimPendingByEmail'
  >> = {
    upsertByRecipientUser: jest.fn(),
    upsertByRecipientEmail: jest.fn(),
    listByRecipientUserId: jest.fn(),
    findByInviteTokenHash: jest.fn(),
    markInviteConsumed: jest.fn(),
    claimPendingByEmail: jest.fn(),
  };

  const sessions: jest.Mocked<Pick<ConversationV2SessionStore, 'findByIds' | 'findById'>> = {
    findByIds: jest.fn(),
    findById: jest.fn(),
  };

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

  beforeEach(async () => {
    jest.clearAllMocks();
    users.findByEmail.mockReset();
    users.findById.mockReset();
    email.isAvailable.mockReturnValue(true);
    email.send.mockResolvedValue({ success: true });
    shares.claimPendingByEmail.mockResolvedValue(undefined);
    shares.markInviteConsumed.mockResolvedValue(undefined);
    sessions.findByIds.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationV2AppShareService,
        ConversationV2ShareService,
        { provide: PgConversationV2AppShareStore, useValue: shares },
        { provide: PgConversationV2SessionStore, useValue: sessions },
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
    users.findById.mockResolvedValueOnce({ id: OWNER_ID, email: 'owner@example.com' });
    users.findByEmail.mockResolvedValueOnce({ id: RECIPIENT_ID });
    shares.upsertByRecipientUser.mockResolvedValueOnce(shareRecord({ id: SHARE_ID }));

    await expect(
      svc.shareByEmails({
        ownerId: OWNER_ID,
        sessionId: SESSION_ID,
        emails: ['colleague@example.com'],
        title: 'Generated app',
        deployedUrl: 'https://apps.example/a',
        lastDeployedAt: null,
      }),
    ).resolves.toEqual({
      shared: [{ shareId: SHARE_ID, recipientEmail: 'colleague@example.com' }],
      notFound: [],
      skippedSelf: [],
    });
    expect(shares.upsertByRecipientUser).toHaveBeenCalled();
    expect(shares.upsertByRecipientUser.mock.calls[0][0].includeConversation).toBe(true);
    expect(shares.upsertByRecipientUser.mock.calls[0][0].inviteTokenHash).toEqual(expect.any(String));
    expect(shares.upsertByRecipientUser.mock.calls[0][0].inviteExpiresAt).toBeInstanceOf(Date);
    expect(shares.upsertByRecipientUser.mock.calls[0][0].inviteConsumedAt).toBeNull();
    expect(shares.upsertByRecipientUser.mock.invocationCallOrder[0]).toBeLessThan(
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
    users.findById.mockResolvedValueOnce({ id: OWNER_ID, email: 'owner@example.com' });
    users.findByEmail.mockResolvedValueOnce({ id: RECIPIENT_ID });
    shares.upsertByRecipientUser.mockResolvedValueOnce(shareRecord({ id: SHARE_ID }));
    email.send.mockResolvedValueOnce({ success: false });

    await expect(
      svc.shareByEmails({
        ownerId: OWNER_ID,
        sessionId: SESSION_ID,
        emails: ['colleague@example.com'],
        title: 'Generated app',
        deployedUrl: 'https://apps.example/a',
        lastDeployedAt: null,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(shares.upsertByRecipientUser).toHaveBeenCalled();
    expect(email.send).toHaveBeenCalled();
  });

  it('shareByEmails invites unknown recipients by email', async () => {
    users.findById.mockResolvedValue({ id: OWNER_ID, email: 'owner@example.com' });
    users.findByEmail.mockResolvedValue(null);
    shares.upsertByRecipientEmail.mockResolvedValue(shareRecord({ id: SHARE_ID }));

    await expect(
      svc.shareByEmails({
        ownerId: OWNER_ID,
        sessionId: SESSION_ID,
        emails: ['missing@example.com'],
        title: 'App',
        deployedUrl: 'https://apps.example/a',
        lastDeployedAt: null,
      }),
    ).resolves.toEqual({
      shared: [{ shareId: SHARE_ID, recipientEmail: 'missing@example.com' }],
      notFound: [],
      skippedSelf: [],
    });
    expect(shares.upsertByRecipientEmail).toHaveBeenCalled();
    expect(shares.upsertByRecipientEmail.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ recipientEmail: 'missing@example.com' }),
    );
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('listSharedWithUser treats legacy shares without includeConversation as conversation-enabled', async () => {
    shares.listByRecipientUserId.mockResolvedValueOnce([
      shareRecord({
        id: SHARE_ID,
        sessionId: SESSION_ID,
        title: 'Legacy shared app',
        deployedUrl: 'https://apps.example/legacy',
        lastDeployedAt: null,
        includeConversation: undefined as unknown as boolean,
      }),
    ]);
    sessions.findByIds.mockResolvedValueOnce([]);

    await expect(svc.listSharedWithUser(RECIPIENT_ID)).resolves.toEqual([
      expect.objectContaining({
        sessionId: SESSION_ID,
        canOpenConversation: true,
      }),
    ]);
  });

  it('listSharedWithUser maps share docs for Marketplace', async () => {
    shares.listByRecipientUserId.mockResolvedValueOnce([
      shareRecord({
        id: SHARE_ID,
        sessionId: SESSION_ID,
        title: 'Shared app',
        deployedUrl: 'https://apps.example/shared',
        lastDeployedAt: new Date('2026-07-16T10:00:00.000Z'),
        includeConversation: true,
      }),
    ]);
    sessions.findByIds.mockResolvedValueOnce([]);

    await expect(svc.listSharedWithUser(RECIPIENT_ID)).resolves.toEqual([
      {
        sessionId: SESSION_ID,
        title: 'Shared app',
        deployedUrl: 'https://apps.example/shared',
        lastDeployedAt: '2026-07-16T10:00:00.000Z',
        source: 'shared',
        shareId: SHARE_ID,
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
    shares.listByRecipientUserId.mockResolvedValueOnce([
      shareRecord({
        id: SHARE_ID,
        sessionId: SESSION_ID,
        title: 'Untitled app',
        deployedUrl: 'https://apps.example/shared',
        lastDeployedAt: null,
        includeConversation: true,
      }),
    ]);
    sessions.findByIds.mockResolvedValueOnce([
      sessionRecord({
        id: SESSION_ID,
        title: 'Old conversation name',
        deployedAppTitle: 'Live deployed title',
      }),
    ]);

    await expect(svc.listSharedWithUser(RECIPIENT_ID)).resolves.toEqual([
      expect.objectContaining({ title: 'Live deployed title' }),
    ]);
  });

  it('listSharedWithUser falls back to the live session title when no deployed title exists', async () => {
    shares.listByRecipientUserId.mockResolvedValueOnce([
      shareRecord({
        id: SHARE_ID,
        sessionId: SESSION_ID,
        title: 'Untitled app',
        deployedUrl: 'https://apps.example/shared',
        lastDeployedAt: null,
        includeConversation: true,
      }),
    ]);
    sessions.findByIds.mockResolvedValueOnce([
      sessionRecord({ id: SESSION_ID, title: 'Task Manager', deployedAppTitle: null }),
    ]);

    await expect(svc.listSharedWithUser(RECIPIENT_ID)).resolves.toEqual([
      expect.objectContaining({ title: 'Task Manager' }),
    ]);
  });

  it('listSharedWithUser keeps the snapshot title when the session has no live title', async () => {
    shares.listByRecipientUserId.mockResolvedValueOnce([
      shareRecord({
        id: SHARE_ID,
        sessionId: SESSION_ID,
        title: 'Shared app',
        deployedUrl: 'https://apps.example/shared',
        lastDeployedAt: null,
        includeConversation: true,
      }),
    ]);
    sessions.findByIds.mockResolvedValueOnce([
      sessionRecord({ id: SESSION_ID, title: '', deployedAppTitle: null }),
    ]);

    await expect(svc.listSharedWithUser(RECIPIENT_ID)).resolves.toEqual([
      expect.objectContaining({ title: 'Shared app' }),
    ]);
  });

  it('resolveInviteToken returns invite metadata for a live token', async () => {
    const { token, hash } = shareTokens.issue();
    const expiresAt = new Date(Date.now() + 86_400_000);
    shares.findByInviteTokenHash.mockResolvedValueOnce(
      shareRecord({
        id: SHARE_ID,
        recipientEmail: 'guest@example.com',
        inviteExpiresAt: expiresAt,
        inviteConsumedAt: null,
        sessionId: SESSION_ID,
        title: 'Shared app',
        deployedUrl: 'https://apps.example/a/',
      }),
    );
    sessions.findById.mockResolvedValueOnce(
      sessionRecord({ id: SESSION_ID, aiSessionId: 'ws-1', title: 'Live title' }),
    );

    await expect(svc.resolveInviteToken(token)).resolves.toEqual({
      email: 'guest@example.com',
      appTitle: 'Live title',
      deployedUrl: 'https://apps.example/a/',
      sessionId: SESSION_ID,
      workspaceId: 'ws-1',
      expiresAt,
      consumed: false,
    });
    expect(shares.findByInviteTokenHash).toHaveBeenCalledWith(hash);
  });

  it('resolveInviteToken returns null for a blank token', async () => {
    await expect(svc.resolveInviteToken('  ')).resolves.toBeNull();
    expect(shares.findByInviteTokenHash).not.toHaveBeenCalled();
  });

  it('consumeInviteToken marks a matching live invite as consumed', async () => {
    const { token } = shareTokens.issue();
    shares.findByInviteTokenHash.mockResolvedValueOnce(
      shareRecord({
        id: SHARE_ID,
        recipientEmail: 'guest@example.com',
        inviteExpiresAt: new Date(Date.now() + 86_400_000),
        inviteConsumedAt: null,
      }),
    );

    await expect(svc.consumeInviteToken(token, 'guest@example.com')).resolves.toBe(true);
    expect(shares.markInviteConsumed).toHaveBeenCalledWith(SHARE_ID);
  });

  it('consumeInviteToken is idempotent when already consumed by the same email', async () => {
    const { token } = shareTokens.issue();
    shares.findByInviteTokenHash.mockResolvedValueOnce(
      shareRecord({
        id: SHARE_ID,
        recipientEmail: 'guest@example.com',
        inviteExpiresAt: new Date(Date.now() + 86_400_000),
        inviteConsumedAt: new Date(),
      }),
    );

    await expect(svc.consumeInviteToken(token, 'guest@example.com')).resolves.toBe(true);
    expect(shares.markInviteConsumed).not.toHaveBeenCalled();
  });

  it('consumeInviteToken rejects expired or mismatched emails', async () => {
    const { token } = shareTokens.issue();
    shares.findByInviteTokenHash.mockResolvedValueOnce(
      shareRecord({
        id: SHARE_ID,
        recipientEmail: 'guest@example.com',
        inviteExpiresAt: new Date(Date.now() - 1000),
        inviteConsumedAt: null,
      }),
    );
    await expect(svc.consumeInviteToken(token, 'guest@example.com')).resolves.toBe(false);

    shares.findByInviteTokenHash.mockResolvedValueOnce(
      shareRecord({
        id: SHARE_ID,
        recipientEmail: 'guest@example.com',
        inviteExpiresAt: new Date(Date.now() + 86_400_000),
        inviteConsumedAt: null,
      }),
    );
    await expect(svc.consumeInviteToken(token, 'other@example.com')).resolves.toBe(false);
  });
});
