import { Types } from 'mongoose';
import { ExecutionContext } from '@nestjs/common';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { ForbiddenException } from '../../exceptions';

const OWNER = new Types.ObjectId();
const OTHER = new Types.ObjectId();

function ctxFor(user: { _id: Types.ObjectId }, workspaceId: string): { ctx: ExecutionContext; req: any } {
  const req: any = { user, params: { id: workspaceId } };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function makeGuard(workspace: any, share: any) {
  const workspaceModel: any = { findById: () => ({ exec: () => Promise.resolve(workspace) }) };
  const shareModel: any = { findOne: () => ({ lean: () => ({ exec: () => Promise.resolve(share) }) }) };
  return new WorkspaceAccessGuard(workspaceModel, shareModel);
}

describe('WorkspaceAccessGuard — public access', () => {
  const wsId = new Types.ObjectId().toString();

  it('grants read to a non-owner when the workspace is public (no share needed)', async () => {
    const guard = makeGuard({ _id: wsId, createdBy: OWNER, isPublic: true }, null);
    const { ctx, req } = ctxFor({ _id: OTHER }, wsId);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.workspaceRole).toBe('read');
  });

  it('downgrades a readwrite-shared user to read while the workspace is public (dormant share)', async () => {
    const guard = makeGuard(
      { _id: wsId, createdBy: OWNER, isPublic: true },
      { permission: 'readwrite' },
    );
    const { ctx, req } = ctxFor({ _id: OTHER }, wsId);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.workspaceRole).toBe('read');
  });

  it('still forbids a non-owner on a private workspace with no share', async () => {
    const guard = makeGuard({ _id: wsId, createdBy: OWNER, isPublic: false }, null);
    const { ctx } = ctxFor({ _id: OTHER }, wsId);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives the owner the owner role regardless of isPublic', async () => {
    const guard = makeGuard({ _id: wsId, createdBy: OWNER, isPublic: true }, null);
    const { ctx, req } = ctxFor({ _id: OWNER }, wsId);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.workspaceRole).toBe('owner');
  });
});
