import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { ConversationV2Controller } from './conversation-v2.controller';
import { ConversationV2GrpcClientService } from './services/conversation-v2.grpc-client.service';
import { ConversationV2SessionService } from './services/conversation-v2-session.service';
import { ConversationV2ShareService } from './services/conversation-v2-share.service';
import { ConversationV2EventStoreService } from './services/conversation-v2-event-store.service';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { EmailService } from '@modules/email';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import { VmUnavailableException } from './exceptions/vm-unavailable.exception';
import { ConversationV2DeployService } from './services/conversation-v2-deploy.service';
import { ConversationV2AppShareService } from './services/conversation-v2-app-share.service';
import { ConversationV2SessionAccessGuard } from './guards/conversation-v2-session-access.guard';
import { ConversationV2OwnerGuard } from './guards/conversation-v2-owner.guard';
import type { ConversationV2ResolvedSession } from './services/conversation-v2-session-access.service';
import { RuntimeTicketService } from '@modules/app-runtime/services/runtime-ticket.service';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { CONVERSATION_V2_SESSION_PERMISSION_KEY } from './decorators/require-conversation-session-permission.decorator';
import { ConversationV2SessionPermissions } from './constants/conversation-v2-session-permissions';

describe('ConversationV2Controller', () => {
  let controller: ConversationV2Controller;

  const resolvedSession = (
    ownerId: string,
    pointer: Record<string, unknown> = {},
    viewerRole: 'owner' | 'shared' = 'owner',
  ): ConversationV2ResolvedSession => ({
    ownerId,
    actorUserId: ownerId,
    pointer: pointer as unknown as ConversationV2ResolvedSession['pointer'],
    access: { sessionId: 's1', viewerRole, permissions: [] },
  });

  const mockClient = {
    createSession: jest.fn(),
    getSession: jest.fn(),
    stopSession: jest.fn(),
    pauseSession: jest.fn(),
    resumeSession: jest.fn(),
    getVncSignedUrl: jest.fn(),
  };

  const mockSessions = {
    createDraft: jest.fn(),
    attachAiSession: jest.fn(),
    deleteDraft: jest.fn(),
    list: jest.fn(),
    getOne: jest.fn(),
    getById: jest.fn(),
    getByShareToken: jest.fn(),
    rename: jest.fn(),
    setShared: jest.fn(),
    setDeployState: jest.fn(),
    listDeployedApps: jest.fn(),
    removeDeployedApp: jest.fn(),
    softDelete: jest.fn(),
  };

  const mockShare = {
    issue: jest.fn(),
    hashToken: jest.fn(),
    verify: jest.fn(),
  };

  const mockWorkspaceShare = {
    assertUserHasAccess: jest.fn(),
  };

  const mockWorkspaceDocuments = {
    deleteAllByWorkspace: jest.fn(),
    generateReadUrl: jest.fn(),
    findByMultipleWorkspaces: jest.fn(),
  };

  const mockWorkspaceService = {
    findIdsByOwner: jest.fn(),
    createSystemWorkspace: jest.fn(),
    deleteSystemWorkspace: jest.fn(),
  };

  const mockEventStore = {
    listSince: jest.fn(),
  };

  const mockEmail = {
    isAvailable: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue({ success: true }),
  };

  const mockAppShares = {
    listSharedWithUser: jest.fn(),
    shareByEmails: jest.fn(),
    removeShareForRecipient: jest.fn(),
    deleteAllSharesForSession: jest.fn(),
    syncDeployMetadata: jest.fn(),
  };

  const mockConfig = { get: jest.fn().mockReturnValue(52428800) };
  const mockDeployment = { deploy: jest.fn() };
  const mockRuntimeTickets = { issue: jest.fn() };
  const mockRuntimeRevisions = {
    listFiles: jest.fn(),
    getAuthorizedRevision: jest.fn(),
    resolveObjectKeys: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationV2Controller],
      providers: [
        { provide: ConversationV2GrpcClientService, useValue: mockClient },
        { provide: ConversationV2SessionService, useValue: mockSessions },
        { provide: ConversationV2ShareService, useValue: mockShare },
        { provide: WorkspaceShareService, useValue: mockWorkspaceShare },
        { provide: WorkspaceDocumentService, useValue: mockWorkspaceDocuments },
        { provide: ConversationV2EventStoreService, useValue: mockEventStore },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EmailService, useValue: mockEmail },
        { provide: ConversationV2DeployService, useValue: mockDeployment },
        { provide: ConversationV2AppShareService, useValue: mockAppShares },
        { provide: RuntimeTicketService, useValue: mockRuntimeTickets },
        { provide: RuntimeRevisionService, useValue: mockRuntimeRevisions },
      ],
    })
      .overrideGuard(ConversationV2SessionAccessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ConversationV2OwnerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ConversationV2Controller);

    [
      ...Object.values(mockClient),
      ...Object.values(mockSessions),
      ...Object.values(mockShare),
      ...Object.values(mockWorkspaceShare),
      ...Object.values(mockWorkspaceDocuments),
      ...Object.values(mockWorkspaceService),
      ...Object.values(mockEventStore),
      ...Object.values(mockDeployment),
      ...Object.values(mockAppShares),
      ...Object.values(mockRuntimeTickets),
      ...Object.values(mockRuntimeRevisions),
    ].forEach((fn) => (fn as jest.Mock).mockReset?.());
    mockConfig.get.mockReturnValue(52428800);
    mockAppShares.listSharedWithUser.mockResolvedValue([]);
  });

  // --- POST /sessions ---

  it('POST /sessions creates draft + system workspace + gRPC session, then attaches', async () => {
    const draftId = new Types.ObjectId();
    mockWorkspaceService.findIdsByOwner.mockResolvedValueOnce(['w1']);
    mockSessions.createDraft.mockResolvedValueOnce({ _id: draftId });
    mockWorkspaceService.createSystemWorkspace.mockResolvedValueOnce({ id: 'sysws' });
    mockClient.createSession.mockResolvedValueOnce('ai-1');
    mockSessions.attachAiSession.mockResolvedValueOnce(undefined);

    const result = await controller.createSession({ id: 'u1' } as never);

    expect(result).toEqual({
      sessionId: draftId.toString(),
      workspaceIds: ['w1'],
      systemWorkspaceId: 'sysws',
    });
    // Empty selection expands to the owner's workspaces, which are forwarded to gRPC.
    expect(mockClient.createSession).toHaveBeenCalledWith('u1', ['w1']);
    expect(mockSessions.attachAiSession).toHaveBeenCalledWith(draftId, 'ai-1', 'sysws');
  });

  // --- GET /sessions ---

  it('GET /sessions returns paginated items and nextCursor null when fewer than limit', async () => {
    mockSessions.list.mockResolvedValueOnce([]);
    const result = await controller.listSessions({ id: 'u1' } as never, { limit: 20 } as never);
    expect(result).toEqual({ items: [], nextCursor: null });
  });

  it('GET /sessions returns nextCursor when a full page is returned', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      sessionId: `s${i}`,
      title: '',
      status: 'active' as const,
      lastEventAt: `2024-01-${(i + 1).toString().padStart(2, '0')}T00:00:00.000Z`,
      isShared: false,
    }));
    mockSessions.list.mockResolvedValueOnce(items);
    const result = await controller.listSessions({ id: 'u1' } as never, { limit: 20 } as never);
    expect(result.nextCursor).toBe(items[19].lastEventAt);
  });

  // --- GET /sessions/:id ---

  it('GET /sessions/:id returns the pointer payload', async () => {
    const id = new Types.ObjectId();
    mockSessions.getById.mockResolvedValueOnce({
      _id: id,
      ownerId: 'u1',
      title: 't',
      status: 'active',
      isShared: false,
      workspaceIds: ['w1'],
      lastEventAt: new Date('2024-01-01T00:00:00.000Z'),
      eventCount: 3,
      systemWorkspaceId: 'sysws',
    });
    const result = await controller.getSession(id.toString(), {
      conversationV2Access: {
        viewerRole: 'owner',
        permissions: ['session.read', 'events.read', 'stream.write'],
      },
    } as never);
    expect(result.sessionId).toBe(id.toString());
    expect(result.eventCount).toBe(3);
    expect(result.systemWorkspaceId).toBe('sysws');
    expect(result.viewerRole).toBe('owner');
    expect(result.permissions).toContain('session.read');
  });

  it('GET /sessions/:id throws NotFoundException when the pointer is missing', async () => {
    mockSessions.getById.mockResolvedValueOnce(null);
    await expect(
      controller.getSession('s1', {
        conversationV2Access: { viewerRole: 'owner', permissions: ['session.read'] },
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- PATCH /sessions/:id ---

  it('PATCH /sessions/:id renames when title provided', async () => {
    mockSessions.rename.mockResolvedValueOnce({ title: 'New Name' });
    const result = await controller.patchSession(resolvedSession('u1'), 's1', { title: 'New Name' });
    expect(result.title).toBe('New Name');
    expect(mockSessions.rename).toHaveBeenCalledWith('u1', 's1', 'New Name');
  });

  it('PATCH /sessions/:id issues a share token when isShared=true', async () => {
    mockShare.issue.mockReturnValueOnce({ token: 'tok', hash: 'hsh' });
    mockSessions.setShared.mockResolvedValueOnce({});
    const result = await controller.patchSession(resolvedSession('u1'), 's1', { isShared: true });
    expect(result.isShared).toBe(true);
    expect(result.shareToken).toBe('tok');
    expect(mockSessions.setShared).toHaveBeenCalledWith('u1', 's1', true, 'hsh');
  });

  it('PATCH /sessions/:id clears the share token when isShared=false', async () => {
    mockSessions.setShared.mockResolvedValueOnce({});
    const result = await controller.patchSession(resolvedSession('u1'), 's1', { isShared: false });
    expect(result.isShared).toBe(false);
    expect(result.shareToken).toBeNull();
    expect(mockSessions.setShared).toHaveBeenCalledWith('u1', 's1', false, null);
  });

  // --- DELETE /sessions/:id ---

  it('DELETE /sessions/:id removes the system workspace then soft-deletes', async () => {
    mockWorkspaceDocuments.deleteAllByWorkspace.mockResolvedValueOnce(undefined);
    mockWorkspaceService.deleteSystemWorkspace.mockResolvedValueOnce(undefined);
    mockSessions.softDelete.mockResolvedValueOnce({});
    const result = await controller.deleteSession(
      resolvedSession('u1', { systemWorkspaceId: 'sysws' }),
      's1',
    );
    expect(result).toEqual({ deleted: true });
    expect(mockWorkspaceDocuments.deleteAllByWorkspace).toHaveBeenCalledWith('sysws');
    expect(mockWorkspaceService.deleteSystemWorkspace).toHaveBeenCalledWith('sysws');
    expect(mockSessions.softDelete).toHaveBeenCalledWith('u1', 's1');
  });

  // --- POST /sessions/:id/stop|pause|resume ---

  it('POST /sessions/:id/stop resolves the aiSessionId and calls gRPC stop', async () => {
    mockClient.stopSession.mockResolvedValueOnce(undefined);
    await expect(
      controller.stopSession(resolvedSession('u1', { aiSessionId: 'ai-1' })),
    ).resolves.toEqual({
      success: true,
    });
    expect(mockClient.stopSession).toHaveBeenCalledWith('u1', 'ai-1');
  });

  it('POST /sessions/:id/stop throws NotFoundException when session has no aiSessionId', async () => {
    await expect(
      controller.stopSession(resolvedSession('u1', { aiSessionId: null })),
    ).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('POST /sessions/:id/stop translates gRPC NOT_FOUND to NotFoundException', async () => {
    const err = new Error('nope') as grpc.ServiceError;
    (err as { code?: number }).code = grpc.status.NOT_FOUND;
    mockClient.stopSession.mockRejectedValueOnce(err);
    await expect(
      controller.stopSession(resolvedSession('u1', { aiSessionId: 'ai-1' })),
    ).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('POST /sessions/:id/pause resolves the aiSessionId and calls gRPC pause', async () => {
    mockClient.pauseSession.mockResolvedValueOnce(undefined);
    await expect(
      controller.pauseSession(resolvedSession('u1', { aiSessionId: 'ai-1' })),
    ).resolves.toEqual({
      success: true,
    });
    expect(mockClient.pauseSession).toHaveBeenCalledWith('u1', 'ai-1');
  });

  it('POST /sessions/:id/resume resolves the aiSessionId and calls gRPC resume', async () => {
    mockClient.resumeSession.mockResolvedValueOnce(undefined);
    await expect(
      controller.resumeSession(resolvedSession('u1', { aiSessionId: 'ai-1' })),
    ).resolves.toEqual({
      success: true,
    });
    expect(mockClient.resumeSession).toHaveBeenCalledWith('u1', 'ai-1');
  });

  it('GET /apps returns owned and shared deployed apps', async () => {
    mockSessions.listDeployedApps.mockResolvedValueOnce([
      {
        sessionId: 'session-1',
        title: 'Generated app',
        deployedUrl: 'https://apps.example/app-1',
        lastDeployedAt: '2026-07-17T10:00:00.000Z',
        source: 'owned',
        shareId: null,
        canOpenConversation: true,
      },
    ]);
    mockAppShares.listSharedWithUser.mockResolvedValueOnce([
      {
        sessionId: 'session-2',
        title: 'Shared app',
        deployedUrl: 'https://apps.example/app-2',
        lastDeployedAt: '2026-07-16T10:00:00.000Z',
        source: 'shared',
        shareId: 'share-2',
        canOpenConversation: true,
      },
    ]);

    await expect(controller.listDeployedApps({ id: 'user-1' })).resolves.toEqual({
      items: [
        {
          sessionId: 'session-1',
          title: 'Generated app',
          deployedUrl: 'https://apps.example/app-1',
          lastDeployedAt: '2026-07-17T10:00:00.000Z',
          source: 'owned',
          shareId: null,
          canOpenConversation: true,
        },
        {
          sessionId: 'session-2',
          title: 'Shared app',
          deployedUrl: 'https://apps.example/app-2',
          lastDeployedAt: '2026-07-16T10:00:00.000Z',
          source: 'shared',
          shareId: 'share-2',
          canOpenConversation: true,
        },
      ],
    });
    expect(mockAppShares.listSharedWithUser).toHaveBeenCalledWith('user-1');
  });

  it('POST /sessions/:id/share-deploy grants Marketplace access by email', async () => {
    mockAppShares.shareByEmails.mockResolvedValueOnce({
      shared: [{ shareId: 'share-1', recipientEmail: 'colleague@example.com' }],
      notFound: [],
      skippedSelf: [],
    });

    await expect(
      controller.shareDeploy(
        resolvedSession('user-1', {
          deployStatus: 'deployed',
          deployedUrl: 'https://apps.example/app-1',
          deployedAppTitle: 'Generated app',
          title: 'Conversation title',
          lastDeployedAt: '2026-07-17T10:00:00.000Z',
        }),
        'session-1',
        {
          emails: ['colleague@example.com'],
        },
      ),
    ).resolves.toEqual({ sent: 1, notFound: [], skippedSelf: [] });
  });

  it('DELETE /apps/:id clears deploy state and shares for the owner', async () => {
    mockSessions.removeDeployedApp.mockResolvedValueOnce({});

    await expect(
      controller.removeDeployedApp({ id: 'user-1' }, 'session-1'),
    ).resolves.toBeUndefined();
    expect(mockAppShares.deleteAllSharesForSession).toHaveBeenCalledWith('session-1');
  });

  it('DELETE /apps/:id removes a shared app for the recipient', async () => {
    mockSessions.removeDeployedApp.mockResolvedValueOnce(null);
    mockAppShares.removeShareForRecipient.mockResolvedValueOnce(true);

    await expect(
      controller.removeDeployedApp({ id: 'user-2' }, 'session-1'),
    ).resolves.toBeUndefined();
    expect(mockAppShares.removeShareForRecipient).toHaveBeenCalledWith('user-2', 'session-1');
  });

  it('POST /sessions/:id/deploy calls app-builder with the user and AI session ids', async () => {
    mockSessions.setDeployState.mockResolvedValue({});
    mockDeployment.deploy.mockResolvedValueOnce({ url: 'https://deployed.example/app' });
    const result = await controller.deploySession(
      resolvedSession('user-1', {
        aiSessionId: 'conversation-1',
        title: 'Conversation title',
      }),
      'session-1',
      { title: 'Generated app' },
    );

    expect(mockDeployment.deploy).toHaveBeenCalledWith('user-1', 'conversation-1');
    expect(mockSessions.setDeployState).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'session-1',
      { deployStatus: 'deploying' },
    );
    expect(mockSessions.setDeployState).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'session-1',
      expect.objectContaining({
        deployStatus: 'deployed',
        deployedUrl: 'https://deployed.example/app',
        deployedAppTitle: 'Generated app',
      }),
    );
    expect(mockAppShares.syncDeployMetadata).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        title: 'Generated app',
        deployedUrl: 'https://deployed.example/app',
      }),
    );
    expect(result.deployedUrl).toBe('https://deployed.example/app');
  });

  // --- GET /share/v2/:token ---

  it('GET /share/v2/:token returns the session payload + events for a valid token', async () => {
    const id = new Types.ObjectId();
    mockShare.hashToken.mockReturnValueOnce('hsh');
    mockSessions.getByShareToken.mockResolvedValueOnce({
      _id: id,
      title: 't',
      status: 'active',
      isShared: true,
      workspaceIds: [],
      systemWorkspaceId: null,
    });
    mockEventStore.listSince.mockResolvedValueOnce([]);
    const result = await controller.getShared('tok');
    expect(result.session.sessionId).toBe(id.toString());
    expect(result.events).toEqual([]);
    expect(mockShare.hashToken).toHaveBeenCalledWith('tok');
    expect(mockSessions.getByShareToken).toHaveBeenCalledWith('hsh');
  });

  it('GET /share/v2/:token throws NotFoundException for an invalid token', async () => {
    mockShare.hashToken.mockReturnValueOnce('badhsh');
    mockSessions.getByShareToken.mockResolvedValueOnce(null);
    await expect(controller.getShared('badtok')).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- GET /sessions/:id/vnc/signed-url ---

  it('GET /sessions/:id/vnc/signed-url returns url + expiresAt when gRPC responds', async () => {
    mockClient.getVncSignedUrl.mockResolvedValueOnce({
      url: 'wss://vnc.example.com/token',
      expiresAt: 9999999,
    });
    const result = await controller.vncSignedUrl(
      resolvedSession('u1', { aiSessionId: 'ai-1' }),
    );
    expect(result).toEqual({ url: 'wss://vnc.example.com/token', expiresAt: 9999999 });
    expect(mockClient.getVncSignedUrl).toHaveBeenCalledWith('u1', 'ai-1');
  });

  it('GET /sessions/:id/vnc/signed-url throws VmUnavailableException (409) when gRPC returns null', async () => {
    mockClient.getVncSignedUrl.mockResolvedValue(null);
    const err = await controller
      .vncSignedUrl(resolvedSession('u1', { aiSessionId: 'ai-1' }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(VmUnavailableException);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getStatus()).toBe(409);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'VM_UNAVAILABLE' });
  });

  // --- POST /sessions/:id/runtime-ticket ---

  it('POST /sessions/:id/runtime-ticket returns a browser ticket and never the MCP token', async () => {
    mockRuntimeTickets.issue.mockResolvedValueOnce({
      runtimeSessionId: 'rts_0011223344556677',
      ticket: 'one-shot-ticket',
      workspaceId: 'sess_1',
      revisionId: 'rev_0',
      expiresAt: '2026-01-01T00:01:00.000Z',
    });

    const result = await controller.issueRuntimeTicket({ id: 'u1' }, 'sess_1');

    expect(mockRuntimeTickets.issue).toHaveBeenCalledWith({
      conversationSessionId: 'sess_1',
      userId: 'u1',
    });
    expect(Object.keys(result).sort()).toEqual([
      'expiresAt',
      'revisionId',
      'runtimeSessionId',
      'ticket',
      'workspaceId',
    ]);
  });

  it('POST /sessions/:id/runtime-ticket requires the session write permission', () => {
    const permission = Reflect.getMetadata(
      CONVERSATION_V2_SESSION_PERMISSION_KEY,
      ConversationV2Controller.prototype.issueRuntimeTicket,
    );
    expect(permission).toBe(ConversationV2SessionPermissions.SESSION_WRITE);
  });
});
