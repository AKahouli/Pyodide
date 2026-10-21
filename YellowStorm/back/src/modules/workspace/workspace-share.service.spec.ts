import { Types } from 'mongoose';
import { WorkspaceShareService } from './workspace-share.service';
import { LoggerService } from '../logger';
import { UserService } from '../user';
import { NotificationsService } from '../notifications/notifications.service';
import { ForbiddenException } from '../exceptions';

const USER = new Types.ObjectId().toString();
const WS = new Types.ObjectId().toString();

// D.10 cutover: the service now reads through the WorkspaceStore/ShareStore
// contracts, so the harness injects store mocks shaped per test.
function build(overrides: { workspaceStore?: any; shareStore?: any; outbox?: any; semanticGrantRevocations?: any; maxIds?: number } = {}) {
  const workspaceStore: any = {
    findById: jest.fn().mockResolvedValue(null),
    filterOwned: jest.fn().mockResolvedValue([]),
    filterPublic: jest.fn().mockResolvedValue([]),
    incrementCounters: jest.fn().mockResolvedValue(undefined),
    ...overrides.workspaceStore,
  };
  const shareStore: any = {
    findById: jest.fn().mockResolvedValue(null),
    findOneByWorkspaceAndUser: jest.fn().mockResolvedValue(null),
    filterSharedWithUser: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    updatePermission: jest.fn().mockResolvedValue(undefined),
    deleteById: jest.fn().mockResolvedValue(undefined),
    ...overrides.shareStore,
  };
  const semanticGrantRevocations = {
    runWithWorkspaceRevocation: jest.fn(async (_workspaceId: string, _userId: string, work: () => Promise<unknown>) => work()),
    ...overrides.semanticGrantRevocations,
  };
  const svc = new WorkspaceShareService(
    workspaceStore,
    shareStore,
    { byId: jest.fn().mockResolvedValue(null), byIds: jest.fn().mockResolvedValue(new Map()), byEmails: jest.fn().mockResolvedValue(new Map()) },
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as LoggerService,
    {} as unknown as UserService,
    {} as unknown as NotificationsService,
    semanticGrantRevocations as never,
    { get: jest.fn().mockReturnValue(overrides.maxIds ?? 1000) } as never,
    overrides.outbox,
  );
  return { svc, workspaceStore, shareStore, semanticGrantRevocations };
}

describe('WorkspaceShareService — public access', () => {
  it('fails closed on overflowing MCP snapshots without truncating permissions', async () => {
    const findReadableIds = jest.fn().mockResolvedValue(Array.from({ length: 1001 }, () => WS));
    const { svc } = build({ workspaceStore: { findReadableIds } });
    await expect(svc.readableWorkspaceScope(USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findReadableIds).toHaveBeenCalledWith(USER, 1001);
    findReadableIds.mockResolvedValueOnce([]);
    await expect(svc.readableWorkspaceScope(USER)).resolves.toEqual([]);
  });
  it('accepts broad readable sets below the configured bound', async () => {
    const ids = Array.from({ length: 152 }, (_value, index) => index.toString(16).padStart(24, '0'));
    const findReadableIds = jest.fn().mockResolvedValue(ids);
    const { svc } = build({ workspaceStore: { findReadableIds } });
    await expect(svc.readableWorkspaceScope(USER)).resolves.toEqual(ids);
    expect(findReadableIds).toHaveBeenCalledWith(USER, 1001);
  });
  it('honors a lower configured bound', async () => {
    const findReadableIds = jest.fn().mockResolvedValue(Array.from({ length: 51 }, () => WS));
    const { svc } = build({ workspaceStore: { findReadableIds }, maxIds: 50 });
    await expect(svc.readableWorkspaceScope(USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findReadableIds).toHaveBeenCalledWith(USER, 51);
  });
  it('hasAccess returns true for a non-owner when the workspace is public', async () => {
    const { svc, workspaceStore } = build({
      workspaceStore: {
        findById: jest.fn().mockResolvedValue({ id: WS, createdBy: new Types.ObjectId().toString(), isPublic: true }),
      },
    });
    await expect(svc.hasAccess(USER, WS)).resolves.toBe(true);
    expect(workspaceStore.findById).toHaveBeenCalledWith(WS);
  });

  it('assertUserHasAccess passes when a requested workspace is public', async () => {
    const { svc, workspaceStore } = build({
      workspaceStore: {
        filterOwned: jest.fn().mockResolvedValue([]),
        filterPublic: jest.fn().mockResolvedValue([WS]),
      },
    });
    await expect(svc.assertUserHasAccess(USER, [WS])).resolves.toBeUndefined();
    expect(workspaceStore.filterPublic).toHaveBeenCalledWith([WS]);
  });

  it('share() rejects a public workspace', async () => {
    const { svc } = build({
      workspaceStore: {
        findById: jest.fn().mockResolvedValue({
          id: WS,
          createdBy: USER,
          isSystem: false,
          isPublic: true,
        }),
      },
    });
    await expect(
      svc.share(WS, USER, { shares: [{ email: 'a@x.io', permission: 'read' }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('WorkspaceShareService write access', () => {
  it('allows the workspace owner', async () => {
    const { svc } = build({
      workspaceStore: {
        findById: jest.fn().mockResolvedValue({ id: WS, createdBy: USER, isPublic: false }),
      },
    });

    await expect(svc.assertUserHasWriteAccess(USER, WS)).resolves.toBeUndefined();
  });

  it('allows a readwrite recipient', async () => {
    const { svc } = build({
      workspaceStore: {
        findById: jest.fn().mockResolvedValue({ id: WS, createdBy: new Types.ObjectId().toString(), isPublic: false }),
      },
      shareStore: {
        findOneByWorkspaceAndUser: jest.fn().mockResolvedValue({ id: 's1', permission: 'readwrite' }),
      },
    });

    await expect(svc.assertUserHasWriteAccess(USER, WS)).resolves.toBeUndefined();
  });

  it.each([
    { isPublic: true, share: null },
    { isPublic: false, share: { permission: 'read' } },
  ])('rejects read-only access', async ({ isPublic, share }) => {
    const { svc } = build({
      workspaceStore: {
        findById: jest.fn().mockResolvedValue({ id: WS, createdBy: new Types.ObjectId().toString(), isPublic }),
      },
      shareStore: {
        findOneByWorkspaceAndUser: jest.fn().mockResolvedValue(share),
      },
    });

    await expect(svc.assertUserHasWriteAccess(USER, WS)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('records an access-change event when a share is revoked', async () => {
    const outbox = { record: jest.fn().mockResolvedValue(undefined) };
    const { svc } = build({
      outbox,
      shareStore: {
        findById: jest.fn().mockResolvedValue({
          id: 'share-1', workspaceId: WS, ownerId: new Types.ObjectId().toString(), sharedWithUserId: USER,
        }),
      },
    });

    await svc.revoke(WS, 'share-1');

    expect(outbox.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'workspace.access.changed.v1',
      aggregateId: `${WS}:${USER}`,
      payload: expect.objectContaining({ workspaceId: WS, userId: USER, changeType: 'revoked' }),
    }));
  });

  it('keeps the share when durable grant revocation fails', async () => {
    const deleteById = jest.fn();
    const { svc } = build({
      shareStore: {
        findById: jest.fn().mockResolvedValue({
          id: 'share-1', workspaceId: WS, ownerId: new Types.ObjectId().toString(), sharedWithUserId: USER,
        }),
        deleteById,
      },
      semanticGrantRevocations: {
        runWithWorkspaceRevocation: jest.fn().mockRejectedValue(new Error('agentstore unavailable')),
      },
    });

    await expect(svc.revoke(WS, 'share-1')).rejects.toThrow('agentstore unavailable');
    expect(deleteById).not.toHaveBeenCalled();
  });
});
