import { ErrorCode } from '../exceptions/constants/error-codes';
import { ProjectShareService } from './project-share.service';

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

function projectDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => PROJECT_ID },
    name: 'BPCE',
    createdBy: { toString: () => OWNER_ID },
    isPublic: false,
    shareCount: 0,
    ...overrides,
  };
}

function shareDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => SHARE_ID },
    projectId: { toString: () => PROJECT_ID },
    ownerId: { toString: () => OWNER_ID },
    sharedWithUserId: { toString: () => RECIPIENT_ID },
    permission: 'read',
    sharedBy: { toString: () => OWNER_ID },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createService(overrides: {
  project?: Record<string, unknown> | null;
  shareModel?: Record<string, jest.Mock>;
  projectModel?: Record<string, jest.Mock>;
} = {}): {
  service: ProjectShareService;
  projectModel: Record<string, jest.Mock>;
  shareModel: Record<string, jest.Mock>;
  conversationStore: Record<string, jest.Mock>;
  userService: Record<string, jest.Mock>;
  notificationsService: Record<string, jest.Mock>;
} {
  const projectModel = {
    findById: jest.fn().mockImplementation(() => {
      const doc = overrides.project === null ? null : projectDoc(overrides.project);
      return {
        lean: () => ({ exec: () => Promise.resolve(doc) }),
        exec: () => Promise.resolve(doc),
      };
    }),
    exists: jest.fn().mockReturnValue({ exec: () => Promise.resolve(false) }),
    updateOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve({}) }),
    ...overrides.projectModel,
  };
  const shareModel = {
    findById: jest.fn(),
    findOne: jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(null) }),
      exec: () => Promise.resolve(null),
    }),
    create: jest.fn().mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(shareDoc(input)),
    ),
    updateOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve({}) }),
    deleteOne: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ deletedCount: 0 }) }),
    countDocuments: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    ...overrides.shareModel,
  };
  const conversationStore = {
    countByProjects: jest.fn().mockResolvedValue(new Map([[PROJECT_ID, 4]])),
    countByProject: jest.fn().mockResolvedValue(4),
  };
  const userService = {
    findById: jest.fn().mockResolvedValue(ownerDoc()),
    findByEmail: jest.fn().mockImplementation((email: string) =>
      Promise.resolve(email === 'ghost@example.com' ? null : recipientDoc()),
    ),
  };
  const notificationsService = { sendToUser: jest.fn().mockResolvedValue({}) };
  const service = new ProjectShareService(
    projectModel as never,
    shareModel as never,
    conversationStore as never,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
    userService as never,
    notificationsService as never,
  );
  return { service, projectModel, shareModel, conversationStore, userService, notificationsService };
}

describe('ProjectShareService', () => {
  const shareDto = { shares: [{ email: 'member@example.com', permission: 'read' as const }] };

  it('creates a share, bumps shareCount and notifies the recipient', async () => {
    const { service, shareModel, projectModel, notificationsService } = createService();

    const result = await service.share(PROJECT_ID, OWNER_ID, shareDto);

    expect(shareModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: expect.anything(),
        sharedWithUserId: expect.anything(),
        permission: 'read',
      }),
    );
    expect(projectModel.updateOne).toHaveBeenCalledWith(
      { _id: PROJECT_ID },
      { $inc: { shareCount: 1 } },
    );
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
    const { service, shareModel } = createService();

    const result = await service.share(PROJECT_ID, OWNER_ID, {
      shares: [
        { email: 'ghost@example.com', permission: 'read' },
        { email: 'owner@example.com', permission: 'readwrite' },
      ],
    });

    expect(result.notFound).toEqual(['ghost@example.com']);
    expect(result.invalid).toEqual(['owner@example.com']);
    expect(shareModel.create).not.toHaveBeenCalled();
  });

  it('updates the permission when a share already exists', async () => {
    const { service, shareModel, notificationsService } = createService({
      shareModel: {
        findOne: jest.fn().mockImplementation(() => {
          let called = false;
          return {
            lean: () => ({ exec: () => Promise.resolve(null) }),
            exec: () => {
              if (called) return Promise.resolve(null);
              called = true;
              return Promise.resolve(shareDoc());
            },
          };
        }),
      },
    });

    const result = await service.share(PROJECT_ID, OWNER_ID, {
      shares: [{ email: 'member@example.com', permission: 'readwrite' }],
    });

    expect(shareModel.updateOne).toHaveBeenCalledWith(
      { _id: expect.anything() },
      { $set: { permission: 'readwrite' } },
    );
    expect(notificationsService.sendToUser).toHaveBeenCalledWith(
      RECIPIENT_ID,
      expect.objectContaining({ title: 'Access updated' }),
    );
    expect(result.shared).toHaveLength(1);
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

    const pub = createService({ project: { isPublic: true } });
    await expect(pub.service.share(PROJECT_ID, OWNER_ID, shareDto)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_SHARE_PUBLIC,
    });
  });

  it('updates and revokes shares with a project mismatch guard', async () => {
    const { service, shareModel, projectModel } = createService();
    (shareModel.findById as jest.Mock).mockReturnValue({
      exec: () => Promise.resolve(shareDoc()),
    });

    const updated = await service.updatePermission(PROJECT_ID, SHARE_ID, 'readwrite');
    expect(updated.permission).toBe('readwrite');
    expect(shareModel.updateOne).toHaveBeenCalled();

    await service.revoke(PROJECT_ID, SHARE_ID);
    expect(shareModel.deleteOne).toHaveBeenCalledWith({ _id: SHARE_ID });
    expect(projectModel.updateOne).toHaveBeenCalledWith(
      { _id: PROJECT_ID },
      { $inc: { shareCount: -1 } },
    );

    (shareModel.findById as jest.Mock).mockReturnValue({
      exec: () =>
        Promise.resolve(shareDoc({ projectId: { toString: () => '61a1b2c3d4e5f6a7b8c9d0f1' } })),
    });
    await expect(service.updatePermission(PROJECT_ID, SHARE_ID, 'read')).rejects.toMatchObject({
      code: ErrorCode.PROJECT_SHARE_NOT_FOUND,
    });
    await expect(service.revoke(PROJECT_ID, SHARE_ID)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_SHARE_NOT_FOUND,
    });
  });

  it('lists projects shared with a user with conversation counts', async () => {
    const { service, conversationStore } = createService({
      shareModel: {
        find: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([
            {
              ...shareDoc(),
              sharedWithUserId: RECIPIENT_ID,
              projectId: {
                _id: { toString: () => PROJECT_ID },
                name: 'BPCE',
                createdAt: now,
                updatedAt: now,
              },
              sharedBy: {
                _id: { toString: () => OWNER_ID },
                email: 'owner@example.com',
                profile: { firstName: 'Ada', lastName: 'Owner' },
              },
            },
          ]),
        }),
        countDocuments: jest.fn().mockResolvedValue(1),
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
    const { service, projectModel, shareModel } = createService();
    let isPublic = false;
    (projectModel.exists as jest.Mock).mockImplementation((filter: Record<string, unknown>) => ({
      exec: () =>
        Promise.resolve(
          (filter as { createdBy?: { toString(): string } }).createdBy !== undefined
            ? (filter as { createdBy?: { toString(): string } }).createdBy!.toString() === OWNER_ID
            : isPublic,
        ),
    }));
    const shareExists = (value: boolean) => {
      (shareModel as Record<string, jest.Mock>).exists = jest
        .fn()
        .mockReturnValue({ exec: () => Promise.resolve(value) });
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
      shareModel: {
        findOne: jest.fn().mockReturnValue({
          lean: () => ({ exec: () => Promise.resolve({ permission: 'readwrite' }) }),
        }),
      },
    });
    await expect(
      readwriteShare.service.assertProjectWriteAccess(RECIPIENT_ID, PROJECT_ID),
    ).resolves.toBeUndefined();

    const readOnlyShare = createService({
      shareModel: {
        findOne: jest.fn().mockReturnValue({
          lean: () => ({ exec: () => Promise.resolve({ permission: 'read' }) }),
        }),
      },
    });
    await expect(
      readOnlyShare.service.assertProjectWriteAccess(RECIPIENT_ID, PROJECT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_SHARE_READ_ONLY });

    const noShare = createService();
    await expect(
      noShare.service.assertProjectWriteAccess(RECIPIENT_ID, PROJECT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_FORBIDDEN });

    const publicProject = createService({ project: { isPublic: true } });
    await expect(
      publicProject.service.assertProjectWriteAccess(RECIPIENT_ID, PROJECT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_SHARE_READ_ONLY });

    await expect(
      createService().service.assertProjectWriteAccess(OWNER_ID, PROJECT_ID),
    ).resolves.toBeUndefined();
  });

  it('removes all shares when a project is deleted', async () => {
    const { service, shareModel } = createService();

    await service.removeAllByProject(PROJECT_ID);

    expect(shareModel.deleteMany).toHaveBeenCalledWith({ projectId: expect.anything() });
  });
});
