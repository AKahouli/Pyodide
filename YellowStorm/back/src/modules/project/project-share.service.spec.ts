import { ErrorCode } from '../exceptions/constants/error-codes';
import { ProjectShareService } from './project-share.service';
import type { ProjectRecord } from './persistence/project-record.mapper';

const now = new Date('2026-09-11T10:00:00.000Z');
const OWNER_ID = '61a1b2c3d4e5f6a7b8c9d0e1';
const RECIPIENT_ID = '61a1b2c3d4e5f6a7b8c9d0e2';
const PROJECT_ID = '61a1b2c3d4e5f6a7b8c9d0e3';
const SHARE_ID = '61a1b2c3d4e5f6a7b8c9d0e4';

function ownerDoc() {
  return {
    _id: { toString: () => OWNER_ID },
    email: 'owner@example.com',
    profile: { firstName: 'Ada', lastName: 'Owner' },
  };
}

function recipientDoc() {
  return {
    _id: { toString: () => RECIPIENT_ID },
    email: 'member@example.com',
    profile: {},
  };
}

function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: PROJECT_ID,
    name: 'BPCE',
    createdBy: OWNER_ID,
    isPublic: false,
    shareCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function shareRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: SHARE_ID,
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
    sharedWithUserId: RECIPIENT_ID,
    permission: 'read' as const,
    sharedBy: OWNER_ID,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createService(overrides: {
  project?: ProjectRecord | null;
  projectStore?: Record<string, jest.Mock>;
  shareStore?: Record<string, jest.Mock>;
  usersByIds?: Map<string, { id: string; email: string; firstName: string; lastName: string }>;
} = {}): {
  service: ProjectShareService;
  projectStore: Record<string, jest.Mock>;
  shareStore: Record<string, jest.Mock>;
  conversationStore: Record<string, jest.Mock>;
  userService: Record<string, jest.Mock>;
  notificationsService: Record<string, jest.Mock>;
} {
  const projectStore = {
    findById: jest.fn().mockResolvedValue(overrides.project === null ? null : projectRecord(overrides.project)),
    findByIds: jest.fn().mockResolvedValue(new Map([[PROJECT_ID, projectRecord()]])),
    existsOwnedBy: jest.fn().mockResolvedValue(false),
    existsPublic: jest.fn().mockResolvedValue(false),
    incrementShareCount: jest.fn().mockResolvedValue(undefined),
    ...overrides.projectStore,
  };
  const shareStore = {
    findById: jest.fn().mockResolvedValue(null),
    findOneByProjectAndUser: jest.fn().mockResolvedValue(null),
    existsForUser: jest.fn().mockResolvedValue(false),
    findByProject: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findByUser: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    create: jest.fn().mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(shareRecord(input)),
    ),
    updatePermission: jest.fn().mockImplementation((id: string, permission: string) =>
      Promise.resolve(shareRecord({ id, permission })),
    ),
    deleteById: jest.fn().mockResolvedValue(true),
    deleteByProject: jest.fn().mockResolvedValue(0),
    ...overrides.shareStore,
  };
  const conversationStore = {
    countByProjects: jest.fn().mockResolvedValue(new Map([[PROJECT_ID, 4]])),
    countByProject: jest.fn().mockResolvedValue(4),
  };
  const userLookup = {
    byId: jest.fn().mockResolvedValue(null),
    byIds: jest.fn().mockResolvedValue(
      overrides.usersByIds ?? new Map([[OWNER_ID, { id: OWNER_ID, email: 'owner@example.com', firstName: 'Ada', lastName: 'Owner' }]]),
    ),
  };
  const userService = {
    findById: jest.fn().mockResolvedValue(ownerDoc()),
    findByEmail: jest.fn().mockImplementation((email: string) =>
      Promise.resolve(email === 'ghost@example.com' ? null : recipientDoc()),
    ),
  };
  const notificationsService = { sendToUser: jest.fn().mockResolvedValue({}) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  // Fake pool: withTransaction runs the callback directly against the store mocks.
  const db = { transaction: (cb: (tx: unknown) => Promise<unknown>) => cb({}) };
  const service = new ProjectShareService(
    projectStore as never,
    shareStore as never,
    conversationStore as never,
    userLookup as never,
    notificationsService as never,
    userService as never,
    logger as never,
    db as never,
  );
  return { service, projectStore, shareStore, conversationStore, userService, notificationsService };
}

describe('ProjectShareService', () => {
  const shareDto = { shares: [{ email: 'member@example.com', permission: 'read' as const }] };

  it('creates a share, bumps shareCount and notifies the recipient', async () => {
    const { service, shareStore, projectStore, notificationsService } = createService();

    const result = await service.share(PROJECT_ID, OWNER_ID, shareDto);

    expect(shareStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        sharedWithUserId: RECIPIENT_ID,
        permission: 'read',
      }),
    );
    expect(projectStore.incrementShareCount).toHaveBeenCalledWith(PROJECT_ID, 1);
    expect(notificationsService.sendToUser).toHaveBeenCalledWith(
      RECIPIENT_ID,
      expect.objectContaining({ title: 'Project shared' }),
    );
    expect(result.shared).toHaveLength(1);
    expect(result.shared[0].user).toMatchObject({ email: 'member@example.com' });
    expect(result.notFound).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it('reports unknown emails and self-shares without failing the batch', async () => {
    const { service, shareStore } = createService();

    const result = await service.share(PROJECT_ID, OWNER_ID, {
      shares: [
        { email: 'ghost@example.com', permission: 'read' },
        { email: 'owner@example.com', permission: 'readwrite' },
      ],
    });

    expect(result.notFound).toEqual(['ghost@example.com']);
    expect(result.invalid).toEqual(['owner@example.com']);
    expect(shareStore.create).not.toHaveBeenCalled();
  });

  it('updates the permission when a share already exists', async () => {
    const { service, shareStore, projectStore, notificationsService } = createService({
      shareStore: {
        findOneByProjectAndUser: jest.fn().mockResolvedValue(shareRecord()),
      },
    });

    const result = await service.share(PROJECT_ID, OWNER_ID, {
      shares: [{ email: 'member@example.com', permission: 'readwrite' }],
    });

    expect(shareStore.updatePermission).toHaveBeenCalledWith(SHARE_ID, 'readwrite');
    expect(projectStore.incrementShareCount).not.toHaveBeenCalled();
    expect(notificationsService.sendToUser).toHaveBeenCalledWith(
      RECIPIENT_ID,
      expect.objectContaining({ title: 'Access updated' }),
    );
    expect(result.shared).toHaveLength(1);
  });

  it('re-sharing at the current permission neither writes nor notifies', async () => {
    const { service, shareStore, projectStore, notificationsService } = createService({
      shareStore: {
        findOneByProjectAndUser: jest.fn().mockResolvedValue(shareRecord()),
      },
    });

    const result = await service.share(PROJECT_ID, OWNER_ID, shareDto);

    expect(shareStore.updatePermission).not.toHaveBeenCalled();
    expect(shareStore.create).not.toHaveBeenCalled();
    expect(projectStore.incrementShareCount).not.toHaveBeenCalled();
    expect(notificationsService.sendToUser).not.toHaveBeenCalled();
    expect(result.shared).toHaveLength(1);
    expect(result.shared[0].updatedAt).toBe(now.toISOString());
  });

  it('keeps duplicate emails in one batch to a single share row', async () => {
    const { service, shareStore, projectStore } = createService();

    const result = await service.share(PROJECT_ID, OWNER_ID, {
      shares: [
        { email: 'member@example.com', permission: 'read' },
        { email: 'member@example.com', permission: 'read' },
      ],
    });

    expect(shareStore.create).toHaveBeenCalledTimes(1);
    expect(projectStore.incrementShareCount).toHaveBeenCalledWith(PROJECT_ID, 1);
    expect(result.shared).toHaveLength(2);
    expect(result.shared[0].id).toBe(result.shared[1].id);
  });

  it('rejects sharing when the project is missing, foreign, or public', async () => {
    const missing = createService({ project: null });
    await expect(missing.service.share(PROJECT_ID, OWNER_ID, shareDto)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_NOT_FOUND,
    });

    const foreign = createService();
    await expect(
      foreign.service.share(PROJECT_ID, '61a1b2c3d4e5f6a7b8c9d0e9', shareDto),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_FORBIDDEN });

    const pub = createService({ project: projectRecord({ isPublic: true }) });
    await expect(pub.service.share(PROJECT_ID, OWNER_ID, shareDto)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_SHARE_PUBLIC,
    });
  });

  it('updates and revokes shares with a project mismatch guard', async () => {
    const { service, shareStore, projectStore } = createService();
    (shareStore.findById as jest.Mock).mockResolvedValue(shareRecord());

    const updated = await service.updatePermission(PROJECT_ID, SHARE_ID, 'readwrite');
    expect(updated.permission).toBe('readwrite');
    expect(shareStore.updatePermission).toHaveBeenCalledWith(SHARE_ID, 'readwrite');

    await service.revoke(PROJECT_ID, SHARE_ID);
    expect(shareStore.deleteById).toHaveBeenCalledWith(SHARE_ID);
    expect(projectStore.incrementShareCount).toHaveBeenCalledWith(PROJECT_ID, -1);

    (shareStore.findById as jest.Mock).mockResolvedValue(
      shareRecord({ projectId: '61a1b2c3d4e5f6a7b8c9d0f1' }),
    );
    await expect(service.updatePermission(PROJECT_ID, SHARE_ID, 'read')).rejects.toMatchObject({
      code: ErrorCode.PROJECT_SHARE_NOT_FOUND,
    });
    await expect(service.revoke(PROJECT_ID, SHARE_ID)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_SHARE_NOT_FOUND,
    });
  });

  it('decrements shareCount only when revoke actually deleted the row', async () => {
    const { service, shareStore, projectStore, notificationsService } = createService();
    (shareStore.findById as jest.Mock).mockResolvedValue(shareRecord());
    (shareStore.deleteById as jest.Mock).mockResolvedValue(false); // lost a concurrent revoke

    await expect(service.revoke(PROJECT_ID, SHARE_ID)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_SHARE_NOT_FOUND,
    });
    expect(projectStore.incrementShareCount).not.toHaveBeenCalled();
    expect(notificationsService.sendToUser).not.toHaveBeenCalled();
  });

  it('normalizes uppercase ids before hitting the stores', async () => {
    const { service, shareStore } = createService();
    (shareStore.findById as jest.Mock).mockResolvedValue(shareRecord());
    await service.revoke(PROJECT_ID.toUpperCase(), SHARE_ID.toUpperCase());
    expect(shareStore.findById).toHaveBeenCalledWith(SHARE_ID);
    expect(shareStore.deleteById).toHaveBeenCalledWith(SHARE_ID);
  });

  it('maps a concurrent duplicate share (unique violation) to 409', async () => {
    const dup = Object.assign(new Error('Failed query'), {
      cause: { code: '23505', constraint: 'uq_project_shares_project_user' },
    });
    const { service, projectStore } = createService({
      shareStore: { create: jest.fn().mockRejectedValue(dup) },
    });
    await expect(service.share(PROJECT_ID, OWNER_ID, shareDto)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
    expect(projectStore.incrementShareCount).not.toHaveBeenCalled();
  });

  it('lists projects shared with a user with conversation counts', async () => {
    const { service, conversationStore } = createService({
      shareStore: {
        findByUser: jest.fn().mockResolvedValue({ rows: [shareRecord()], total: 1 }),
      },
    });

    const result = await service.findSharedWithUser(RECIPIENT_ID, { page: 1, limit: 20 });

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      id: PROJECT_ID,
      name: 'BPCE',
      conversationCount: 4,
      permission: 'read',
      shareId: SHARE_ID,
      owner: { email: 'owner@example.com' },
    });
    expect(conversationStore.countByProjects).toHaveBeenCalledWith([PROJECT_ID]);
  });

  it('computes access: owner, share, or public', async () => {
    const { service, projectStore, shareStore } = createService();
    let isPublic = false;
    (projectStore.existsOwnedBy as jest.Mock).mockImplementation((_projectId: string, ownerId: string) =>
      Promise.resolve(ownerId === OWNER_ID),
    );
    (projectStore.existsPublic as jest.Mock).mockImplementation(() => Promise.resolve(isPublic));
    const shareExists = (value: boolean) => {
      (shareStore as Record<string, jest.Mock>).existsForUser = jest.fn().mockResolvedValue(value);
    };

    shareExists(false);
    await expect(service.hasAccess(OWNER_ID, PROJECT_ID)).resolves.toBe(true);
    await expect(service.hasAccess(RECIPIENT_ID, PROJECT_ID)).resolves.toBe(false);

    shareExists(true);
    await expect(service.hasAccess(RECIPIENT_ID, PROJECT_ID)).resolves.toBe(true);

    shareExists(false);
    isPublic = true;
    await expect(service.hasAccess(RECIPIENT_ID, PROJECT_ID)).resolves.toBe(true);
  });

  it('enforces write access on the project', async () => {
    const readwriteShare = createService({
      shareStore: {
        findOneByProjectAndUser: jest.fn().mockResolvedValue(shareRecord({ permission: 'readwrite' })),
      },
    });
    await expect(
      readwriteShare.service.assertProjectWriteAccess(RECIPIENT_ID, PROJECT_ID),
    ).resolves.toBeUndefined();

    const readOnlyShare = createService({
      shareStore: {
        findOneByProjectAndUser: jest.fn().mockResolvedValue(shareRecord({ permission: 'read' })),
      },
    });
    await expect(
      readOnlyShare.service.assertProjectWriteAccess(RECIPIENT_ID, PROJECT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_SHARE_READ_ONLY });

    const noShare = createService();
    await expect(
      noShare.service.assertProjectWriteAccess(RECIPIENT_ID, PROJECT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_FORBIDDEN });

    const publicProject = createService({ project: projectRecord({ isPublic: true }) });
    await expect(
      publicProject.service.assertProjectWriteAccess(RECIPIENT_ID, PROJECT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_SHARE_READ_ONLY });

    await expect(
      createService().service.assertProjectWriteAccess(OWNER_ID, PROJECT_ID),
    ).resolves.toBeUndefined();
  });

  it('removes all shares when a project is deleted', async () => {
    const { service, shareStore } = createService();

    await service.removeAllByProject(PROJECT_ID);

    expect(shareStore.deleteByProject).toHaveBeenCalledWith(PROJECT_ID);
  });
});
