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
  workspaceStore.listPublic = jest.fn().mockResolvedValue({ items: [], total: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).workspaceStore = workspaceStore;
  (svc as any).userLookup = { byIds: jest.fn().mockResolvedValue(new Map()) };
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
    const ownerUser = { id: ownerId.toString(), email: 'o@x.io', firstName: 'O', lastName: 'W' };
    const wsRecord = {
      id: WS, name: 'Pub', alias: 'pub', storagePrefix: 'pub', description: 'd',
      createdBy: ownerId.toString(), documentCount: 2, usedStorage: 5, allocatedStorage: 100,
      isSystem: false, isPersonal: false, shareCount: 0, isPublic: true,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const { svc, workspaceStore } = makeService();
    workspaceStore.listPublic = jest.fn().mockResolvedValue({ items: [wsRecord], total: 1 });
    (svc as any).userLookup = {
      byIds: jest.fn().mockResolvedValue(new Map([[ownerId.toString(), ownerUser]])),
    };

    const res = await svc.findPublic(OWNER, { page: 1, limit: 20 });

    // The store scopes the query: public + non-system + excluding the requester.
    expect(workspaceStore.listPublic).toHaveBeenCalledWith(OWNER, { search: undefined, skip: 0, limit: 20 });
    expect(res.workspaces).toHaveLength(1);
    expect(res.workspaces[0].owner.email).toBe('o@x.io');
    expect(res.workspaces[0]).not.toHaveProperty('permission');
    expect(res.pagination.total).toBe(1);
  });

  it('omits a public workspace whose owner user was deleted (lookup misses) without throwing', async () => {
    const ownerId = new Types.ObjectId();
    const deletedOwnerId = new Types.ObjectId();
    const ownerUser = { id: ownerId.toString(), email: 'o@x.io', firstName: 'O', lastName: 'W' };
    const wsWithOwner = {
      id: new Types.ObjectId().toString(), name: 'Pub', alias: 'pub', storagePrefix: 'pub', description: 'd',
      createdBy: ownerId.toString(), documentCount: 2, usedStorage: 5, allocatedStorage: 100,
      isSystem: false, isPersonal: false, shareCount: 0, isPublic: true,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const wsWithDeletedOwner = {
      id: WS, name: 'Orphan', alias: 'orphan', storagePrefix: 'orphan', description: 'd',
      createdBy: deletedOwnerId.toString(), documentCount: 0, usedStorage: 0, allocatedStorage: 100,
      isSystem: false, isPersonal: false, shareCount: 0, isPublic: true,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const { svc, workspaceStore } = makeService();
    workspaceStore.listPublic = jest.fn().mockResolvedValue({ items: [wsWithOwner, wsWithDeletedOwner], total: 2 });
    (svc as any).userLookup = {
      byIds: jest.fn().mockResolvedValue(new Map([[ownerId.toString(), ownerUser]])),
    };

    const res = await svc.findPublic(OWNER, { page: 1, limit: 20 });

    expect(res.workspaces).toHaveLength(1);
    expect(res.workspaces[0].name).toBe('Pub');
    expect(res.workspaces.some((w) => w.name === 'Orphan')).toBe(false);
    expect(res.pagination.total).toBe(2);
  });
});

describe('WorkspaceService.delete ordering', () => {
  function build(withDb: boolean) {
    const calls: string[] = [];
    const svc = Object.create(WorkspaceService.prototype) as WorkspaceService;
    const s = svc as any;
    s.workspaceStore = {
      findById: jest.fn().mockResolvedValue({ id: WS, createdBy: OWNER, isPersonal: false, name: 'w' }),
      deleteById: jest.fn(async () => { calls.push('workspace'); }),
    };
    s.shareStore = { deleteManyByWorkspace: jest.fn(async () => { calls.push('shares'); }) };
    s.conversationStore = { removeWorkspaceFromAll: jest.fn(async () => { calls.push('conversations'); return 0; }) };
    s.agentRepository = { pullKnowledgeBaseFromAll: jest.fn(async () => { calls.push('agents'); }) };
    s.flowReadPort = { removeWorkspaceReference: jest.fn(async () => { calls.push('flows'); }) };
    s.logger = { setContext: () => {}, log: () => {}, warn: () => {} };
    if (withDb) {
      s.db = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        calls.push('begin');
        const r = await fn({});
        calls.push('commit');
        return r;
      }) };
    }
    return { svc, calls };
  }

  it('removes conversation refs and shares before deleting the workspace, in a transaction', async () => {
    const { svc, calls } = build(true);
    await svc.delete(WS, OWNER);
    expect(calls).toEqual(['conversations', 'begin', 'shares', 'workspace', 'commit', 'agents', 'flows']);
  });

  it('keeps the same ordering without a database handle', async () => {
    const { svc, calls } = build(false);
    await svc.delete(WS, OWNER);
    expect(calls).toEqual(['conversations', 'shares', 'workspace', 'agents', 'flows']);
  });
});
