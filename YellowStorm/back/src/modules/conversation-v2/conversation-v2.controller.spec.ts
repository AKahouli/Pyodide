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

describe('ConversationV2Controller', () => {
  let controller: ConversationV2Controller;

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
    getByShareToken: jest.fn(),
    rename: jest.fn(),
    setShared: jest.fn(),
    setDeployState: jest.fn(),
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

  const mockConfig = { get: jest.fn().mockReturnValue(52428800) };
  const mockDeployment = { deploy: jest.fn() };

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
      ],
    }).compile();
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
    ].forEach((fn) => (fn as jest.Mock).mockReset?.());
    mockConfig.get.mockReturnValue(52428800);
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
    mockSessions.getOne.mockResolvedValueOnce({
      _id: id,
      title: 't',
      status: 'active',
      isShared: false,
      workspaceIds: ['w1'],
      lastEventAt: new Date('2024-01-01T00:00:00.000Z'),
      eventCount: 3,
      systemWorkspaceId: 'sysws',
    });
    const result = await controller.getSession({ id: 'u1' } as never, id.toString());
    expect(result.sessionId).toBe(id.toString());
    expect(result.eventCount).toBe(3);
    expect(result.systemWorkspaceId).toBe('sysws');
  });

  it('GET /sessions/:id throws NotFoundException when the pointer is missing', async () => {
    mockSessions.getOne.mockResolvedValueOnce(null);
    await expect(controller.getSession({ id: 'u1' } as never, 's1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // --- PATCH /sessions/:id ---

  it('PATCH /sessions/:id renames when title provided', async () => {
    mockSessions.rename.mockResolvedValueOnce({ title: 'New Name' });
    const result = await controller.patchSession({ id: 'u1' } as never, 's1', { title: 'New Name' });
    expect(result.title).toBe('New Name');
    expect(mockSessions.rename).toHaveBeenCalledWith('u1', 's1', 'New Name');
  });

  it('PATCH /sessions/:id issues a share token when isShared=true', async () => {
    mockShare.issue.mockReturnValueOnce({ token: 'tok', hash: 'hsh' });
    mockSessions.setShared.mockResolvedValueOnce({});
    const result = await controller.patchSession({ id: 'u1' } as never, 's1', { isShared: true });
    expect(result.isShared).toBe(true);
    expect(result.shareToken).toBe('tok');
    expect(mockSessions.setShared).toHaveBeenCalledWith('u1', 's1', true, 'hsh');
  });

  it('PATCH /sessions/:id clears the share token when isShared=false', async () => {
    mockSessions.setShared.mockResolvedValueOnce({});
    const result = await controller.patchSession({ id: 'u1' } as never, 's1', { isShared: false });
    expect(result.isShared).toBe(false);
    expect(result.shareToken).toBeNull();
    expect(mockSessions.setShared).toHaveBeenCalledWith('u1', 's1', false, null);
  });

  // --- DELETE /sessions/:id ---

  it('DELETE /sessions/:id removes the system workspace then soft-deletes', async () => {
    mockSessions.getOne.mockResolvedValueOnce({ systemWorkspaceId: 'sysws' });
    mockWorkspaceDocuments.deleteAllByWorkspace.mockResolvedValueOnce(undefined);
    mockWorkspaceService.deleteSystemWorkspace.mockResolvedValueOnce(undefined);
    mockSessions.softDelete.mockResolvedValueOnce({});

    const result = await controller.deleteSession({ id: 'u1' } as never, 's1');
    expect(result).toEqual({ deleted: true });
    expect(mockWorkspaceDocuments.deleteAllByWorkspace).toHaveBeenCalledWith('sysws');
    expect(mockWorkspaceService.deleteSystemWorkspace).toHaveBeenCalledWith('sysws');
    expect(mockSessions.softDelete).toHaveBeenCalledWith('u1', 's1');
  });

  // --- POST /sessions/:id/stop|pause|resume ---

  it('POST /sessions/:id/stop resolves the aiSessionId and calls gRPC stop', async () => {
    mockSessions.getOne.mockResolvedValueOnce({ aiSessionId: 'ai-1' });
    mockClient.stopSession.mockResolvedValueOnce(undefined);
    await expect(controller.stopSession({ id: 'u1' } as never, 's1')).resolves.toEqual({
      success: true,
    });
    expect(mockClient.stopSession).toHaveBeenCalledWith('u1', 'ai-1');
  });

  it('POST /sessions/:id/stop throws NotFoundException when session has no aiSessionId', async () => {
    mockSessions.getOne.mockResolvedValueOnce({ aiSessionId: null });
    await expect(controller.stopSession({ id: 'u1' } as never, 's1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('POST /sessions/:id/stop translates gRPC NOT_FOUND to NotFoundException', async () => {
    mockSessions.getOne.mockResolvedValueOnce({ aiSessionId: 'ai-1' });
    const err = new Error('nope') as grpc.ServiceError;
    (err as { code?: number }).code = grpc.status.NOT_FOUND;
    mockClient.stopSession.mockRejectedValueOnce(err);
    await expect(controller.stopSession({ id: 'u1' } as never, 's1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('POST /sessions/:id/pause resolves the aiSessionId and calls gRPC pause', async () => {
    mockSessions.getOne.mockResolvedValueOnce({ aiSessionId: 'ai-1' });
    mockClient.pauseSession.mockResolvedValueOnce(undefined);
    await expect(controller.pauseSession({ id: 'u1' } as never, 's1')).resolves.toEqual({
      success: true,
    });
    expect(mockClient.pauseSession).toHaveBeenCalledWith('u1', 'ai-1');
  });

  it('POST /sessions/:id/resume resolves the aiSessionId and calls gRPC resume', async () => {
    mockSessions.getOne.mockResolvedValueOnce({ aiSessionId: 'ai-1' });
    mockClient.resumeSession.mockResolvedValueOnce(undefined);
    await expect(controller.resumeSession({ id: 'u1' } as never, 's1')).resolves.toEqual({
      success: true,
    });
    expect(mockClient.resumeSession).toHaveBeenCalledWith('u1', 'ai-1');
  });

  it('POST /sessions/:id/deploy calls app-builder with the user and AI session ids', async () => {
    mockSessions.getOne.mockResolvedValueOnce({ aiSessionId: 'conversation-1' });
    mockSessions.setDeployState.mockResolvedValue({});
    mockDeployment.deploy.mockResolvedValueOnce({ url: 'https://deployed.example/app' });

    const result = await controller.deploySession({ id: 'user-1' }, 'session-1');

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
    mockSessions.getOne.mockResolvedValueOnce({ aiSessionId: 'ai-1' });
    mockClient.getVncSignedUrl.mockResolvedValueOnce({
      url: 'wss://vnc.example.com/token',
      expiresAt: 9999999,
    });
    const result = await controller.vncSignedUrl({ id: 'u1' } as never, 's1');
    expect(result).toEqual({ url: 'wss://vnc.example.com/token', expiresAt: 9999999 });
    expect(mockClient.getVncSignedUrl).toHaveBeenCalledWith('u1', 'ai-1');
  });

  it('GET /sessions/:id/vnc/signed-url throws VmUnavailableException (409) when gRPC returns null', async () => {
    mockSessions.getOne.mockResolvedValue({ aiSessionId: 'ai-1' });
    mockClient.getVncSignedUrl.mockResolvedValue(null);
    const err = await controller.vncSignedUrl({ id: 'u1' } as never, 's1').catch((e) => e);
    expect(err).toBeInstanceOf(VmUnavailableException);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getStatus()).toBe(409);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'VM_UNAVAILABLE' });
  });
});
