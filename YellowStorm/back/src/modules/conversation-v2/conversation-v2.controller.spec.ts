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
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import { VmUnavailableException } from './exceptions/vm-unavailable.exception';
import { ConversationV2DeployService } from './services/conversation-v2-deploy.service';
import { ConversationV2AppShareService } from './services/conversation-v2-app-share.service';
import { ConversationV2SessionAccessGuard } from './guards/conversation-v2-session-access.guard';
import { ConversationV2OwnerGuard } from './guards/conversation-v2-owner.guard';
import type { ConversationV2ResolvedSession } from './services/conversation-v2-session-access.service';
import { RuntimeTicketService } from '@modules/app-runtime/services/runtime-ticket.service';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { RuntimeBindingService } from '@modules/app-runtime/services/runtime-binding.service';
import { RuntimeFinalizedRevisionService } from '@modules/app-runtime/services/runtime-finalized-revision.service';
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
    listDraftApps: jest.fn(),
    resolveRevisionContextBySessionIds: jest.fn(),
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
  const mockRuntimeBindings = { findByWorkspaceId: jest.fn() };
  const mockFinalizedRevisions = {
    backfillFromEvents: jest.fn().mockResolvedValue(undefined),
    listByWorkspace: jest.fn().mockResolvedValue([]),
    resolveLatestFinalized: jest.fn().mockResolvedValue(null),
    assertFinalized: jest.fn().mockResolvedValue(undefined),
    summarizeByWorkspaces: jest.fn().mockResolvedValue(new Map()),
  };

  const emptyRevisionCatalog = {
    lastDeployedRevisionId: null,
    latestFinalizedRevisionId: null,
    latestFinalizedAt: null,
    finalizedVersionCount: 0,
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
        { provide: RuntimeBindingService, useValue: mockRuntimeBindings },
        { provide: RuntimeFinalizedRevisionService, useValue: mockFinalizedRevisions },
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
      ...Object.values(mockRuntimeBindings),
      ...Object.values(mockFinalizedRevisions),
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

  it('POST /sessions rollback drops the draft before the system workspace', async () => {
    const draftId = new Types.ObjectId();
    const calls: string[] = [];
    mockWorkspaceService.findIdsByOwner.mockResolvedValueOnce(['w1']);
    mockSessions.createDraft.mockResolvedValueOnce({ _id: draftId });
    mockWorkspaceService.createSystemWorkspace.mockResolvedValueOnce({ id: 'sysws' });
    mockClient.createSession.mockRejectedValueOnce(new Error('grpc down'));
    mockSessions.deleteDraft.mockImplementationOnce(async () => {
      calls.push('draft');
    });
    mockWorkspaceService.deleteSystemWorkspace.mockImplementationOnce(async () => {
      calls.push('workspace');
    });

    await expect(controller.createSession({ id: 'u1' } as never)).rejects.toThrow('grpc down');
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual(['draft', 'workspace']);
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

  it('DELETE /sessions/:id soft-deletes the session before removing its system workspace', async () => {
    const calls: string[] = [];
    mockWorkspaceDocuments.deleteAllByWorkspace.mockImplementationOnce(async () => {
      calls.push('docs');
    });
    mockWorkspaceService.deleteSystemWorkspace.mockImplementationOnce(async () => {
      calls.push('workspace');
    });
    mockSessions.softDelete.mockImplementationOnce(async () => {
      calls.push('session');
      return {};
    });
    const result = await controller.deleteSession(
      resolvedSession('u1', { systemWorkspaceId: 'sysws' }),
      's1',
    );
    expect(result).toEqual({ deleted: true });
    expect(mockWorkspaceDocuments.deleteAllByWorkspace).toHaveBeenCalledWith('sysws');
    expect(mockWorkspaceService.deleteSystemWorkspace).toHaveBeenCalledWith('sysws');
    expect(mockSessions.softDelete).toHaveBeenCalledWith('u1', 's1');
    expect(calls).toEqual(['session', 'docs', 'workspace']);
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

  it('GET /apps returns deployed, shared, and draft apps with revision catalog fields', async () => {
    mockSessions.listDeployedApps.mockResolvedValueOnce([
      {
        sessionId: 'session-1',
        title: 'Generated app',
        deployedUrl: 'https://apps.example/app-1',
        lastDeployedAt: '2026-07-17T10:00:00.000Z',
        source: 'owned',
        shareId: null,
        canOpenConversation: true,
        ...emptyRevisionCatalog,
      },
    ]);
    mockSessions.listDraftApps.mockResolvedValueOnce([
      {
        sessionId: 'session-3',
        title: 'Draft app',
        lastUpdatedAt: '2026-07-15T10:00:00.000Z',
        deployStatus: 'idle',
        ...emptyRevisionCatalog,
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
        ...emptyRevisionCatalog,
      },
    ]);
    mockSessions.resolveRevisionContextBySessionIds.mockResolvedValueOnce(
      new Map([
        [
          'session-1',
          { aiSessionId: 'ai-1', lastDeployedRevisionId: 'rev_7' },
        ],
        ['session-2', { aiSessionId: 'ai-2', lastDeployedRevisionId: 'rev_3' }],
        ['session-3', { aiSessionId: 'ai-3', lastDeployedRevisionId: null }],
      ]),
    );
    mockFinalizedRevisions.summarizeByWorkspaces.mockResolvedValueOnce(
      new Map([
        [
          'ai-1',
          {
            latestRevisionId: 'rev_12',
            latestFinalizedAt: '2026-09-02T10:00:00.000Z',
            versionCount: 2,
          },
        ],
        [
          'ai-3',
          {
            latestRevisionId: 'rev_5',
            latestFinalizedAt: '2026-09-01T10:00:00.000Z',
            versionCount: 1,
          },
        ],
      ]),
    );

    await expect(controller.listDeployedApps({ id: 'user-1' })).resolves.toEqual({
      deployed: [
        {
          sessionId: 'session-1',
          title: 'Generated app',
          deployedUrl: 'https://apps.example/app-1',
          lastDeployedAt: '2026-07-17T10:00:00.000Z',
          source: 'owned',
          shareId: null,
          canOpenConversation: true,
          lastDeployedRevisionId: 'rev_7',
          latestFinalizedRevisionId: 'rev_12',
          latestFinalizedAt: '2026-09-02T10:00:00.000Z',
          finalizedVersionCount: 2,
        },
      ],
      shared: [
        {
          sessionId: 'session-2',
          title: 'Shared app',
          deployedUrl: 'https://apps.example/app-2',
          lastDeployedAt: '2026-07-16T10:00:00.000Z',
          source: 'shared',
          shareId: 'share-2',
          canOpenConversation: true,
          lastDeployedRevisionId: 'rev_3',
          latestFinalizedRevisionId: null,
          latestFinalizedAt: null,
          finalizedVersionCount: 0,
        },
      ],
      drafts: [
        {
          sessionId: 'session-3',
          title: 'Draft app',
          lastUpdatedAt: '2026-07-15T10:00:00.000Z',
          deployStatus: 'idle',
          lastDeployedRevisionId: null,
          latestFinalizedRevisionId: 'rev_5',
          latestFinalizedAt: '2026-09-01T10:00:00.000Z',
          finalizedVersionCount: 1,
        },
      ],
    });
    expect(mockSessions.resolveRevisionContextBySessionIds).toHaveBeenCalledWith([
      'session-1',
      'session-2',
      'session-3',
    ]);
    expect(mockFinalizedRevisions.summarizeByWorkspaces).toHaveBeenCalledWith([
      'ai-1',
      'ai-2',
      'ai-3',
    ]);
    expect(mockAppShares.listSharedWithUser).toHaveBeenCalledWith('user-1');
    expect(mockSessions.listDraftApps).toHaveBeenCalledWith('user-1');
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

  it('POST /sessions/:id/deploy calls app-builder with aiSessionId and latest finalized revision', async () => {
    mockSessions.setDeployState.mockResolvedValue({});
    mockDeployment.deploy.mockResolvedValueOnce({ url: 'https://apps.yellowsys.org/apps/conversation-1/' });
    mockFinalizedRevisions.resolveLatestFinalized.mockResolvedValueOnce('rev_15');
    const result = await controller.deploySession(
      resolvedSession('user-1', {
        aiSessionId: 'conversation-1',
        title: 'Conversation title',
      }),
      'session-1',
      { title: 'Generated app' },
    );

    expect(mockFinalizedRevisions.backfillFromEvents).toHaveBeenCalledWith(
      'session-1',
      'conversation-1',
    );
    expect(mockFinalizedRevisions.resolveLatestFinalized).toHaveBeenCalledWith('conversation-1');
    expect(mockDeployment.deploy).toHaveBeenCalledWith('conversation-1', 'rev_15');
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
        deployedUrl: 'https://apps.yellowsys.org/apps/conversation-1/',
        deployedAppTitle: 'Generated app',
        lastDeployedRevisionId: 'rev_15',
      }),
    );
    expect(mockAppShares.syncDeployMetadata).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        title: 'Generated app',
        deployedUrl: 'https://apps.yellowsys.org/apps/conversation-1/',
      }),
    );
    expect(result.deployedUrl).toBe('https://apps.yellowsys.org/apps/conversation-1/');
  });

  it('POST /sessions/:id/deploy prefers an explicit revisionId from the client when finalized', async () => {
    mockSessions.setDeployState.mockResolvedValue({});
    mockDeployment.deploy.mockResolvedValueOnce({
      url: 'https://apps.yellowsys.org/apps/conversation-1/',
    });

    await controller.deploySession(
      resolvedSession('user-1', { aiSessionId: 'conversation-1' }),
      'session-1',
      { revisionId: 'rev_15' },
    );

    expect(mockFinalizedRevisions.assertFinalized).toHaveBeenCalledWith(
      'conversation-1',
      'rev_15',
    );
    expect(mockDeployment.deploy).toHaveBeenCalledWith('conversation-1', 'rev_15');
  });

  it('POST /sessions/:id/deploy rejects non-finalized explicit revisionId', async () => {
    mockSessions.setDeployState.mockResolvedValue({});
    mockFinalizedRevisions.assertFinalized.mockRejectedValueOnce(
      new BadRequestException('not finalized'),
    );

    await expect(
      controller.deploySession(
        resolvedSession('user-1', { aiSessionId: 'conversation-1' }),
        'session-1',
        { revisionId: 'rev_99' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockDeployment.deploy).not.toHaveBeenCalled();
  });

  it('POST /sessions/:id/deploy rejects when no finalized revision exists', async () => {
    mockSessions.setDeployState.mockResolvedValue({});
    mockFinalizedRevisions.resolveLatestFinalized.mockResolvedValueOnce(null);

    await expect(
      controller.deploySession(
        resolvedSession('user-1', { aiSessionId: 'conversation-1' }),
        'session-1',
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockDeployment.deploy).not.toHaveBeenCalled();
    expect(mockSessions.setDeployState).toHaveBeenLastCalledWith('user-1', 'session-1', {
      deployStatus: 'error',
    });
  });

  it('GET /sessions/:id/finalized-versions returns sorted finalized revisions', async () => {
    mockFinalizedRevisions.listByWorkspace.mockResolvedValueOnce([
      {
        revisionId: 'rev_12',
        title: 'App v3',
        finalizedAt: '2026-09-02T10:00:00.000Z',
      },
      {
        revisionId: 'rev_7',
        title: 'App v1',
        finalizedAt: '2026-09-01T10:00:00.000Z',
        fileCount: 10,
      },
    ]);

    const result = await controller.listFinalizedVersions(
      resolvedSession('user-1', { aiSessionId: 'conversation-1' }),
      'session-1',
    );

    expect(mockFinalizedRevisions.backfillFromEvents).toHaveBeenCalledWith(
      'session-1',
      'conversation-1',
    );
    expect(result.latestRevisionId).toBe('rev_12');
    expect(result.items).toHaveLength(2);
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

    const result = await controller.issueRuntimeTicket(
      resolvedSession('u1', { aiSessionId: 'sess_1' }),
    );

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

  it('POST /sessions/:id/runtime-ticket throws NotFoundException when the AI session is not attached yet', () => {
    mockRuntimeTickets.issue.mockClear();

    expect(() =>
      controller.issueRuntimeTicket(resolvedSession('u1', { aiSessionId: null })),
    ).toThrow(NotFoundException);
    expect(mockRuntimeTickets.issue).not.toHaveBeenCalled();
  });

  it("POST /sessions/:id/runtime-ticket binds to the owner, not the collaborator asking for the ticket", async () => {
    mockRuntimeTickets.issue.mockResolvedValueOnce({});
    const shared = resolvedSession('owner-1', { aiSessionId: 'sess_1' }, 'shared');
    shared.actorUserId = 'collab-1';

    await controller.issueRuntimeTicket(shared);

    expect(mockRuntimeTickets.issue).toHaveBeenCalledWith({
      conversationSessionId: 'sess_1',
      userId: 'owner-1',
    });
  });

  // --- Revision reads share the runtime workspace key ---

  it('GET /sessions/:id/revisions/:revisionId/files lists from the aiSessionId workspace', async () => {
    mockRuntimeRevisions.listFiles.mockResolvedValueOnce({ revisionId: 'rev_0', files: [] });

    await controller.getRevisionFiles(
      resolvedSession('u1', { aiSessionId: 'sess_1' }),
      'rev_0',
    );

    expect(mockRuntimeRevisions.listFiles).toHaveBeenCalledWith('sess_1', 'rev_0');
  });

  it('POST /sessions/:id/revisions/:revisionId/presign authorizes against the aiSessionId workspace', async () => {
    mockRuntimeRevisions.getAuthorizedRevision.mockResolvedValueOnce({ revisionId: 'rev_0' });
    mockRuntimeRevisions.resolveObjectKeys.mockReturnValueOnce([]);

    await controller.presignRevisionFiles(
      resolvedSession('u1', { aiSessionId: 'sess_1' }),
      'rev_0',
      { paths: ['src/App.tsx'] },
    );

    expect(mockRuntimeRevisions.getAuthorizedRevision).toHaveBeenCalledWith('sess_1', 'rev_0');
  });
});
