import { Types } from 'mongoose';
import { ForbiddenException, NotFoundException } from '../exceptions';

// A thin harness: we test setVisibility/findPublic in isolation by constructing
// the service with mocked models. Import lazily to avoid pulling heavy deps.
import { WorkspaceService } from './workspace.service';

const OWNER = new Types.ObjectId().toString();
const OTHER = new Types.ObjectId().toString();
const WS = new Types.ObjectId().toString();

function makeService(over: { workspaceModel?: any } = {}) {
  const workspaceModel: any = over.workspaceModel ?? {};
  // Only the deps used by setVisibility/findPublic need to be real; the rest can be stubs.
  const svc = Object.create(WorkspaceService.prototype) as WorkspaceService;
  // The service reads through WorkspaceStore; delegate findById to the
  // model-shaped stub so the ownership/mapping tests stay model-driven.
  const workspaceStore: any = {
    findById: async (id: string) => {
      const r = workspaceModel.findById?.(id);
      const doc = r?.exec ? await r.exec() : await r;
      if (!doc) return null;
      return {
        id: doc._id?.toString?.() ?? String(doc._id),
        name: doc.name, alias: doc.alias, storagePrefix: doc.storagePrefix,
        description: doc.description, createdBy: doc.createdBy?.toString?.() ?? String(doc.createdBy),
        documentCount: doc.documentCount, usedStorage: doc.usedStorage, allocatedStorage: doc.allocatedStorage,
        isSystem: doc.isSystem ?? false, isPersonal: doc.isPersonal ?? false,
        shareCount: doc.shareCount ?? 0, isPublic: doc.isPublic ?? false,
        createdAt: doc.createdAt, updatedAt: doc.updatedAt,
      };
    },
    updateFields: jest.fn().mockResolvedValue(undefined),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).workspaceStore = workspaceStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).logger = { setContext: () => {}, log: () => {}, warn: () => {} };
  return { svc, workspaceModel, workspaceStore };
}

describe('WorkspaceService.setVisibility', () => {
  it('rejects making a system workspace public', async () => {
    const { svc } = makeService({
      workspaceModel: {
        findById: () => ({ exec: () => Promise.resolve({ _id: WS, createdBy: new Types.ObjectId(OWNER), isSystem: true, save: jest.fn() }) }),
      },
    });
    await expect(svc.setVisibility(WS, OWNER, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s when the workspace does not exist', async () => {
    const { svc } = makeService({
      workspaceModel: { findById: () => ({ exec: () => Promise.resolve(null) }) },
    });
    await expect(svc.setVisibility(WS, OWNER, true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forbids a non-owner', async () => {
    const { svc } = makeService({
      workspaceModel: {
        findById: () => ({ exec: () => Promise.resolve({ _id: WS, createdBy: new Types.ObjectId(OTHER), isSystem: false, save: jest.fn() }) }),
      },
    });
    await expect(svc.setVisibility(WS, OWNER, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sets isPublic and saves, returning the mapped response', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: new Types.ObjectId(WS),
      name: 'W', alias: 'w', storagePrefix: 'w', description: '',
      createdBy: new Types.ObjectId(OWNER), documentCount: 0, usedStorage: 0, allocatedStorage: 100,
      isSystem: false, isPersonal: false, shareCount: 0, isPublic: false,
      createdAt: new Date(), updatedAt: new Date(), save,
    };
    const { svc, workspaceStore } = makeService({ workspaceModel: { findById: () => ({ exec: () => Promise.resolve(doc) }) } });
    workspaceStore.updateFields.mockImplementation(async (_id: string, patch: any) => {
      Object.assign(doc, patch);
    });
    const res = await svc.setVisibility(WS, OWNER, true);
    expect(doc.isPublic).toBe(true);
    expect(workspaceStore.updateFields).toHaveBeenCalledWith(WS, { isPublic: true });
    expect(save).not.toHaveBeenCalled();
    expect(res.isPublic).toBe(true);
  });
});

describe('WorkspaceService.findPublic', () => {
  it('queries public non-system workspaces excluding the requester and maps owner info', async () => {
    const ownerId = new Types.ObjectId();
    const ownerDoc = { _id: ownerId, email: 'o@x.io', profile: { firstName: 'O', lastName: 'W' } };
    const wsDoc = {
      _id: new Types.ObjectId(WS), name: 'Pub', alias: 'pub', storagePrefix: 'pub', description: 'd',
      createdBy: ownerDoc, documentCount: 2, usedStorage: 5, allocatedStorage: 100,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const find = jest.fn().mockReturnValue({
      populate: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: () => ({ exec: () => Promise.resolve([wsDoc]) }) }) }) }) }),
    });
    const countDocuments = jest.fn().mockReturnValue({ exec: () => Promise.resolve(1) });
    const { svc, workspaceModel } = makeService({ workspaceModel: { find, countDocuments } });

    const res = await svc.findPublic(OWNER, { page: 1, limit: 20 });

    // Query must exclude requester's own + system + only public
    const filterArg = find.mock.calls[0][0];
    expect(filterArg.isPublic).toBe(true);
    expect(filterArg.isSystem).toEqual({ $ne: true });
    expect(filterArg.createdBy).toEqual({ $ne: expect.anything() });
    expect(res.workspaces).toHaveLength(1);
    expect(res.workspaces[0].owner.email).toBe('o@x.io');
    expect(res.workspaces[0]).not.toHaveProperty('permission');
    expect(res.pagination.total).toBe(1);
    void workspaceModel;
  });

  it('omits a public workspace whose owner user was deleted (populate yields null) without throwing', async () => {
    const ownerId = new Types.ObjectId();
    const ownerDoc = { _id: ownerId, email: 'o@x.io', profile: { firstName: 'O', lastName: 'W' } };
    const wsWithOwner = {
      _id: new Types.ObjectId(), name: 'Pub', alias: 'pub', storagePrefix: 'pub', description: 'd',
      createdBy: ownerDoc, documentCount: 2, usedStorage: 5, allocatedStorage: 100,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const wsWithDeletedOwner = {
      _id: new Types.ObjectId(WS), name: 'Orphan', alias: 'orphan', storagePrefix: 'orphan', description: 'd',
      createdBy: null, documentCount: 0, usedStorage: 0, allocatedStorage: 100,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const find = jest.fn().mockReturnValue({
      populate: () => ({
        sort: () => ({
          skip: () => ({ limit: () => ({ lean: () => ({ exec: () => Promise.resolve([wsWithOwner, wsWithDeletedOwner]) }) }) }),
        }),
      }),
    });
    const countDocuments = jest.fn().mockReturnValue({ exec: () => Promise.resolve(2) });
    const { svc } = makeService({ workspaceModel: { find, countDocuments } });

    const res = await svc.findPublic(OWNER, { page: 1, limit: 20 });

    expect(res.workspaces).toHaveLength(1);
    expect(res.workspaces[0].name).toBe('Pub');
    expect(res.workspaces.some((w) => w.name === 'Orphan')).toBe(false);
    expect(res.pagination.total).toBe(2);
  });
});
