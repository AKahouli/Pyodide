import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationV2OwnerGuard } from './conversation-v2-owner.guard';

function ctx(user: { id: string } | undefined, id: string): ExecutionContext {
  const req: any = { user, params: { id } };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('ConversationV2OwnerGuard', () => {
  const sessionSvc = { getOne: jest.fn() };
  const guard = new ConversationV2OwnerGuard(sessionSvc as any);

  beforeEach(() => sessionSvc.getOne.mockReset());

  it('allows owner', async () => {
    sessionSvc.getOne.mockResolvedValue({ ownerId: 'u1', sessionId: 's1' });
    await expect(guard.canActivate(ctx({ id: 'u1' }, 's1'))).resolves.toBe(true);
  });

  it('404s when session is missing or soft-deleted', async () => {
    sessionSvc.getOne.mockResolvedValue(null);
    await expect(guard.canActivate(ctx({ id: 'u1' }, 's1'))).rejects.toThrow(NotFoundException);
  });

  it('403s a non-owner', async () => {
    sessionSvc.getOne.mockResolvedValue({ ownerId: 'someone-else', sessionId: 's1' });
    await expect(guard.canActivate(ctx({ id: 'u1' }, 's1'))).rejects.toThrow(ForbiddenException);
  });
});
