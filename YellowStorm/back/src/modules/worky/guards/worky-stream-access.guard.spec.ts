import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkyStreamAccessGuard } from './worky-stream-access.guard';

function ctx(user: { id: string } | undefined, id: string): ExecutionContext {
  const req: { user?: { id: string }; params: { id?: string } } = { user, params: { id } };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('WorkyStreamAccessGuard', () => {
  const ownerId = new Types.ObjectId().toString();
  const otherId = new Types.ObjectId().toString();
  const streamObjectId = new Types.ObjectId();

  const makeStreams = (doc: unknown | null) => {
    return { findByIdInternal: jest.fn().mockResolvedValue(doc) };
  };

  it('allows the stream owner', async () => {
    const streams = makeStreams({ ownerUserId: new Types.ObjectId(ownerId) });
    const guard = new WorkyStreamAccessGuard(streams as any);
    await expect(guard.canActivate(ctx({ id: ownerId }, streamObjectId.toString()))).resolves.toBe(true);
  });

  it('rejects non-owner with ForbiddenException', async () => {
    const streams = makeStreams({ ownerUserId: new Types.ObjectId(otherId) });
    const guard = new WorkyStreamAccessGuard(streams as any);
    await expect(guard.canActivate(ctx({ id: ownerId }, streamObjectId.toString()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns NotFoundException when the stream does not exist', async () => {
    const streams = makeStreams(null);
    const guard = new WorkyStreamAccessGuard(streams as any);
    await expect(guard.canActivate(ctx({ id: ownerId }, streamObjectId.toString()))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns NotFoundException for malformed stream ids', async () => {
    const streams = makeStreams(null);
    const guard = new WorkyStreamAccessGuard(streams as any);
    await expect(guard.canActivate(ctx({ id: ownerId }, 'not-a-hex'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns NotFoundException when user is missing from the request', async () => {
    const streams = makeStreams(null);
    const guard = new WorkyStreamAccessGuard(streams as any);
    await expect(guard.canActivate(ctx(undefined, streamObjectId.toString()))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
