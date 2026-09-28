import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { newObjectId } from '@common/postgres';
import { WorkyStreamAccessGuard } from './worky-stream-access.guard';

function ctx(user: { id: string } | undefined, id: string, method = 'GET'): ExecutionContext {
  const req = { user, params: { id }, method };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('WorkyStreamAccessGuard', () => {
  const ownerId = newObjectId();
  const otherId = newObjectId();
  const streamId = newObjectId();

  const makeStreams = (record: unknown | null) => {
    return { findByIdInternal: jest.fn().mockResolvedValue(record) };
  };
  const shareFor = (userId: string, permission: 'read' | 'write') =>
    ({ id: newObjectId(), streamId, userId, permission, createdAt: new Date(), updatedAt: new Date() });

  it('allows the stream owner', async () => {
    const streams = makeStreams({ ownerUserId: ownerId, shares: [] });
    const guard = new WorkyStreamAccessGuard(streams as never);
    await expect(guard.canActivate(ctx({ id: ownerId }, streamId))).resolves.toBe(true);
    expect(streams.findByIdInternal).toHaveBeenCalledWith(streamId);
  });

  it('rejects non-owner with ForbiddenException', async () => {
    const streams = makeStreams({ ownerUserId: otherId, shares: [] });
    const guard = new WorkyStreamAccessGuard(streams as never);
    await expect(guard.canActivate(ctx({ id: ownerId }, streamId))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows read shares on GET but rejects writes', async () => {
    const streams = makeStreams({ ownerUserId: otherId, shares: [shareFor(ownerId, 'read')] });
    const guard = new WorkyStreamAccessGuard(streams as never);
    await expect(guard.canActivate(ctx({ id: ownerId }, streamId))).resolves.toBe(true);
    await expect(
      guard.canActivate(ctx({ id: ownerId }, streamId, 'PATCH')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows write shares on mutations', async () => {
    const streams = makeStreams({ ownerUserId: otherId, shares: [shareFor(ownerId, 'write')] });
    const guard = new WorkyStreamAccessGuard(streams as never);
    await expect(
      guard.canActivate(ctx({ id: ownerId }, streamId, 'POST')),
    ).resolves.toBe(true);
  });

  it('returns NotFoundException when the stream does not exist', async () => {
    const streams = makeStreams(null);
    const guard = new WorkyStreamAccessGuard(streams as never);
    await expect(guard.canActivate(ctx({ id: ownerId }, streamId))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns NotFoundException for malformed stream ids without a lookup', async () => {
    const streams = makeStreams(null);
    const guard = new WorkyStreamAccessGuard(streams as never);
    await expect(guard.canActivate(ctx({ id: ownerId }, 'not-a-hex'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(streams.findByIdInternal).not.toHaveBeenCalled();
  });

  it('returns NotFoundException when user is missing from the request', async () => {
    const streams = makeStreams(null);
    const guard = new WorkyStreamAccessGuard(streams as never);
    await expect(guard.canActivate(ctx(undefined, streamId))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
