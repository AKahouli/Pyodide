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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).workspaceModel = workspaceModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).logger = { setContext: () => {}, log: () => {}, warn: () => {} };
  return { svc, workspaceModel };
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
    const { svc } = makeService({ workspaceModel: { findById: () => ({ exec: () => Promise.resolve(doc) }) } });
    const res = await svc.setVisibility(WS, OWNER, true);
    expect(doc.isPublic).toBe(true);
    expect(save).toHaveBeenCalled();
    expect(res.isPublic).toBe(true);
  });
});
