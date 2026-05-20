import { Test, TestingModule } from '@nestjs/testing';
import { ConversationV2Controller } from './conversation-v2.controller';
import { ConversationV2GrpcClientService } from './services/conversation-v2.grpc-client.service';
import { ConversationV2SessionService } from './services/conversation-v2-session.service';
import { ConversationV2ShareService } from './services/conversation-v2-share.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import { VmUnavailableException } from './exceptions/vm-unavailable.exception';
import { ConversationV2OwnerGuard } from './guards/conversation-v2-owner.guard';

describe('ConversationV2Controller', () => {
  let controller: ConversationV2Controller;

  const mockClient: jest.Mocked<
    Pick<ConversationV2GrpcClientService, 'createSession' | 'getSession' | 'stopSession' | 'pauseSession' | 'resumeSession' | 'getVncSignedUrl'>
  > = {
    createSession: jest.fn(),
    getSession: jest.fn(),
    stopSession: jest.fn(),
    pauseSession: jest.fn(),
    resumeSession: jest.fn(),
    getVncSignedUrl: jest.fn(),
  } as never;

  const mockSessions: jest.Mocked<
    Pick<
      ConversationV2SessionService,
      'createForUser' | 'list' | 'getOne' | 'getByShareToken' | 'rename' | 'setShared' | 'softDelete'
    >
  > = {
    createForUser: jest.fn(),
    list: jest.fn(),
    getOne: jest.fn(),
    getByShareToken: jest.fn(),
    rename: jest.fn(),
    setShared: jest.fn(),
    softDelete: jest.fn(),
  } as never;

  const mockShare: jest.Mocked<
    Pick<ConversationV2ShareService, 'issue' | 'hashToken' | 'verify'>
  > = {
    issue: jest.fn(),
    hashToken: jest.fn(),
    verify: jest.fn(),
  } as never;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationV2Controller],
      providers: [
        { provide: ConversationV2GrpcClientService, useValue: mockClient },
        { provide: ConversationV2SessionService, useValue: mockSessions },
        { provide: ConversationV2ShareService, useValue: mockShare },
      ],
    }).compile();
    controller = module.get(ConversationV2Controller);
    [
      ...Object.values(mockClient),
      ...Object.values(mockSessions),
      ...Object.values(mockShare),
    ].forEach((fn) => (fn as jest.Mock).mockReset?.());
  });

  // --- POST /sessions ---

  it('POST /sessions returns the new sessionId and persists pointer', async () => {
    mockClient.createSession.mockResolvedValueOnce('sess-1');
    mockSessions.createForUser.mockResolvedValueOnce({ sessionId: 'sess-1', ownerId: 'u1' } as any);
    const result = await controller.createSession({ id: 'u1' } as any);
    expect(result).toEqual({ sessionId: 'sess-1' });
    expect(mockClient.createSession).toHaveBeenCalledWith('u1');
    expect(mockSessions.createForUser).toHaveBeenCalledWith('u1', 'sess-1');
  });

  // --- GET /sessions ---

  it('GET /sessions returns paginated items and nextCursor null when fewer than limit', async () => {
    mockSessions.list.mockResolvedValueOnce([]);
    const result = await controller.listSessions({ id: 'u1' } as any, { limit: 20 } as any);
    expect(result).toEqual({ items: [], nextCursor: null });
  });

  it('GET /sessions returns nextCursor when full page returned', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      sessionId: `s${i}`,
      title: '',
      status: 'active' as const,
      lastEventAt: `2024-01-0${(i + 1).toString().padStart(2, '0')}T00:00:00.000Z`,
      isShared: false,
    }));
    mockSessions.list.mockResolvedValueOnce(items);
    const result = await controller.listSessions({ id: 'u1' } as any, { limit: 20 } as any);
    expect(result.nextCursor).toBe(items[19].lastEventAt);
  });

  // --- GET /sessions/:id ---

  it('GET /sessions/:id returns session payload', async () => {
    mockClient.getSession.mockResolvedValueOnce({
      sessionId: 's1',
      title: 't',
      status: 'idle',
      isShared: false,
      events: [],
    } as any);
    const result = await controller.getSession({ id: 'u1' } as any, 's1');
    expect(result.sessionId).toBe('s1');
  });

  it('GET /sessions/:id translates gRPC NOT_FOUND to NotFoundException', async () => {
    const err = new Error('nope') as grpc.ServiceError;
    (err as any).code = grpc.status.NOT_FOUND;
    mockClient.getSession.mockRejectedValueOnce(err);
    await expect(controller.getSession({ id: 'u1' } as any, 's1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // --- PATCH /sessions/:id ---

  it('PATCH /sessions/:id renames when title provided', async () => {
    mockSessions.rename.mockResolvedValueOnce({ title: 'New Name' } as any);
    const result = await controller.patchSession({ id: 'u1' } as any, 's1', { title: 'New Name' });
    expect(result.title).toBe('New Name');
    expect(mockSessions.rename).toHaveBeenCalledWith('u1', 's1', 'New Name');
  });

  it('PATCH /sessions/:id issues share token when isShared=true', async () => {
    mockShare.issue.mockReturnValueOnce({ token: 'tok', hash: 'hsh' });
    mockSessions.setShared.mockResolvedValueOnce({} as any);
    const result = await controller.patchSession({ id: 'u1' } as any, 's1', { isShared: true });
    expect(result.isShared).toBe(true);
    expect(result.shareToken).toBe('tok');
    expect(mockSessions.setShared).toHaveBeenCalledWith('u1', 's1', true, 'hsh');
  });

  it('PATCH /sessions/:id clears share token when isShared=false', async () => {
    mockSessions.setShared.mockResolvedValueOnce({} as any);
    const result = await controller.patchSession({ id: 'u1' } as any, 's1', { isShared: false });
    expect(result.isShared).toBe(false);
    expect(result.shareToken).toBeNull();
    expect(mockSessions.setShared).toHaveBeenCalledWith('u1', 's1', false, null);
  });

  // --- DELETE /sessions/:id ---

  it('DELETE /sessions/:id soft-deletes and returns { deleted: true }', async () => {
    mockSessions.softDelete.mockResolvedValueOnce({} as any);
    const result = await controller.deleteSession({ id: 'u1' } as any, 's1');
    expect(result).toEqual({ deleted: true });
    expect(mockSessions.softDelete).toHaveBeenCalledWith('u1', 's1');
  });

  // --- POST /sessions/:id/stop ---

  it('POST /sessions/:id/stop returns success', async () => {
    mockClient.stopSession.mockResolvedValueOnce(undefined);
    await expect(controller.stopSession({ id: 'u1' } as any, 's1')).resolves.toEqual({
      success: true,
    });
    expect(mockClient.stopSession).toHaveBeenCalledWith('u1', 's1');
  });

  // --- POST /sessions/:id/pause ---

  it('POST /sessions/:id/pause returns success', async () => {
    mockClient.pauseSession.mockResolvedValueOnce(undefined);
    await expect(controller.pauseSession({ id: 'u1' } as any, 's1')).resolves.toEqual({
      success: true,
    });
    expect(mockClient.pauseSession).toHaveBeenCalledWith('u1', 's1');
  });

  // --- POST /sessions/:id/resume ---

  it('POST /sessions/:id/resume returns success', async () => {
    mockClient.resumeSession.mockResolvedValueOnce(undefined);
    await expect(controller.resumeSession({ id: 'u1' } as any, 's1')).resolves.toEqual({
      success: true,
    });
    expect(mockClient.resumeSession).toHaveBeenCalledWith('u1', 's1');
  });

  // --- GET /share/v2/:token ---

  it('GET /share/v2/:token returns session for valid token', async () => {
    mockShare.hashToken.mockReturnValueOnce('hsh');
    mockSessions.getByShareToken.mockResolvedValueOnce({
      ownerId: 'u1',
      sessionId: 's1',
    } as any);
    mockClient.getSession.mockResolvedValueOnce({ sessionId: 's1', events: [] } as any);
    const result = await controller.getShared('tok');
    expect(result.sessionId).toBe('s1');
    expect(mockShare.hashToken).toHaveBeenCalledWith('tok');
    expect(mockSessions.getByShareToken).toHaveBeenCalledWith('hsh');
    expect(mockClient.getSession).toHaveBeenCalledWith('u1', 's1');
  });

  it('GET /share/v2/:token throws NotFoundException for invalid token', async () => {
    mockShare.hashToken.mockReturnValueOnce('badhsh');
    mockSessions.getByShareToken.mockResolvedValueOnce(null);
    await expect(controller.getShared('badtok')).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- GET /sessions/:id/vnc/signed-url ---

  it('GET /sessions/:id/vnc/signed-url returns url and expiresAt when gRPC responds', async () => {
    mockClient.getVncSignedUrl.mockResolvedValueOnce({ url: 'wss://vnc.example.com/token', expiresAt: 9999999 });
    const result = await controller.vncSignedUrl({ id: 'u1' } as any, 's1');
    expect(result).toEqual({ url: 'wss://vnc.example.com/token', expiresAt: 9999999 });
    expect(mockClient.getVncSignedUrl).toHaveBeenCalledWith('u1', 's1');
  });

  it('GET /sessions/:id/vnc/signed-url throws VmUnavailableException (409) when gRPC returns null', async () => {
    mockClient.getVncSignedUrl.mockResolvedValue(null);
    await expect(controller.vncSignedUrl({ id: 'u1' } as any, 's1')).rejects.toBeInstanceOf(
      VmUnavailableException,
    );
    const err = await controller.vncSignedUrl({ id: 'u1' } as any, 's1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getStatus()).toBe(409);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'VM_UNAVAILABLE' });
  });
});
