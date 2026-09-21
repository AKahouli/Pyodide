import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { newObjectId } from '@common/postgres/object-id';
import { TeamPermissionGuard } from './team-permission.guard';

describe('TeamPermissionGuard', () => {
  const ownerId = newObjectId();
  const otherId = newObjectId();
  const teamId = newObjectId();
  const team = { id: teamId, createdBy: ownerId, isActive: true };

  function build(required: string | undefined, teamRow: unknown, share: { id: string; permission: string } | null = null) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
    const teamStore = { findById: jest.fn().mockResolvedValue(teamRow) };
    const shareStore = { find: jest.fn().mockResolvedValue(share) };
    const guard = new TeamPermissionGuard(reflector, teamStore as never, shareStore as never);
    return { guard, teamStore, shareStore };
  }

  const ctx = (userId: string, id: string | undefined) => {
    const request: any = { user: { _id: userId }, params: { id } };
    return {
      request,
      context: {
        getHandler: jest.fn(), getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => request }),
      } as any,
    };
  };

  it('passes through when no permission is required', async () => {
    const { guard, teamStore } = build(undefined, team);
    const { context } = ctx(otherId, teamId);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(teamStore.findById).not.toHaveBeenCalled();
  });

  it('404s on a missing or malformed team id without hitting the store', async () => {
    const { guard, teamStore } = build('read', team);
    await expect(guard.canActivate(ctx(ownerId, undefined).context)).rejects.toBeInstanceOf(NotFoundException);
    await expect(guard.canActivate(ctx(ownerId, 'not-an-id').context)).rejects.toBeInstanceOf(NotFoundException);
    expect(teamStore.findById).not.toHaveBeenCalled();
  });

  it('404s on an unknown team', async () => {
    const { guard } = build('read', null);
    await expect(guard.canActivate(ctx(ownerId, teamId).context)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('owner passes any level with owner context and no share lookup', async () => {
    for (const level of ['read', 'write', 'owner']) {
      const { guard, shareStore } = build(level, team);
      const { context, request } = ctx(ownerId, teamId);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.teamContext).toMatchObject({ isOwner: true, permission: 'owner' });
      expect(shareStore.find).not.toHaveBeenCalled();
    }
  });

  it('non-owner is rejected on owner-only endpoints even with a write share', async () => {
    const { guard, shareStore } = build('owner', team, { id: newObjectId(), permission: 'write' });
    await expect(guard.canActivate(ctx(otherId, teamId).context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(shareStore.find).not.toHaveBeenCalled();
  });

  it('non-owner without a share is forbidden', async () => {
    const { guard } = build('read', team, null);
    await expect(guard.canActivate(ctx(otherId, teamId).context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('read share satisfies read and records the share in the context', async () => {
    const share = { id: newObjectId(), permission: 'read' };
    const { guard, shareStore } = build('read', team, share);
    const { context, request } = ctx(otherId, teamId);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(shareStore.find).toHaveBeenCalledWith(teamId, otherId);
    expect(request.teamContext).toMatchObject({ isOwner: false, permission: 'read', shareId: share.id });
  });

  it('write required with only a read share is forbidden (403)', async () => {
    const { guard } = build('write', team, { id: newObjectId(), permission: 'read' });
    await expect(guard.canActivate(ctx(otherId, teamId).context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('write share satisfies write', async () => {
    const { guard } = build('write', team, { id: newObjectId(), permission: 'write' });
    const { context, request } = ctx(otherId, teamId);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.teamContext.permission).toBe('write');
  });
});
