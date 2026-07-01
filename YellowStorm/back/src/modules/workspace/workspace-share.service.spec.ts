import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { WorkspaceShareService } from './workspace-share.service';
import { Workspace } from './schemas/workspace.schema';
import { WorkspaceShare } from './schemas/workspace-share.schema';
import { LoggerService } from '../logger';
import { UserService } from '../user';
import { NotificationsService } from '../notifications/notifications.service';

const USER = new Types.ObjectId().toString();
const WS = new Types.ObjectId().toString();

function build(overrides: { workspaceModel?: any; shareModel?: any } = {}) {
  const workspaceModel: any = {
    exists: jest.fn().mockReturnValue({ exec: () => Promise.resolve(null) }),
    find: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }) }),
    findById: jest.fn(),
    updateOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve({}) }),
    ...overrides.workspaceModel,
  };
  const shareModel: any = {
    exists: jest.fn().mockReturnValue({ exec: () => Promise.resolve(null) }),
    find: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }) }),
    ...overrides.shareModel,
  };
  const svc = new WorkspaceShareService(
    workspaceModel,
    shareModel,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as LoggerService,
    {} as unknown as UserService,
    {} as unknown as NotificationsService,
  );
  return { svc, workspaceModel, shareModel };
}

describe('WorkspaceShareService — public access', () => {
  it('hasAccess returns true for a non-owner when the workspace is public', async () => {
    const { svc, workspaceModel, shareModel } = build();
    // owner check + share check both false; public existence check true
    workspaceModel.exists = jest
      .fn()
      // first call: owner exists? -> null
      .mockReturnValueOnce({ exec: () => Promise.resolve(null) })
      // second call (public): exists -> truthy
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: WS }) });
    shareModel.exists = jest.fn().mockReturnValue({ exec: () => Promise.resolve(null) });
    await expect(svc.hasAccess(USER, WS)).resolves.toBe(true);
  });

  it('assertUserHasAccess passes when a requested workspace is public', async () => {
    const { svc, workspaceModel } = build();
    // owned: none; shared: none; public: the requested id
    workspaceModel.find = jest
      .fn()
      // owned
      .mockReturnValueOnce({ select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }) })
      // public
      .mockReturnValueOnce({ select: () => ({ lean: () => ({ exec: () => Promise.resolve([{ _id: new Types.ObjectId(WS) }]) }) }) });
    await expect(svc.assertUserHasAccess(USER, [WS])).resolves.toBeUndefined();
  });
});
