import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { ConversationV2OwnerGuard } from './conversation-v2-owner.guard';

function ctx(user: { id: string } | undefined, id: string): ExecutionContext {
  const req: any = { user, params: { id } };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('ConversationV2OwnerGuard', () => {
  const accessSvc = { resolveSession: jest.fn() };
  const guard = new ConversationV2OwnerGuard(accessSvc as any);

  beforeEach(() => accessSvc.resolveSession.mockReset());

  it('allows owner', async () => {
    const resolved = {
      ownerId: 'u1',
      actorUserId: 'u1',
      pointer: { aiSessionId: 'ai-1' },
      access: { viewerRole: 'owner', permissions: [] },
    };
    accessSvc.resolveSession.mockResolvedValue(resolved);
    const request = ctx({ id: 'u1' }, 's1');
    await expect(guard.canActivate(request)).resolves.toBe(true);
    expect((request.switchToHttp().getRequest() as any).conversationV2Session).toBe(resolved);
  });

  it('allows shared participant with conversation access', async () => {
    accessSvc.resolveSession.mockResolvedValue({
      ownerId: 'owner-1',
      actorUserId: 'u1',
      pointer: { aiSessionId: 'ai-1' },
      access: { viewerRole: 'shared', permissions: [] },
    });
    await expect(guard.canActivate(ctx({ id: 'u1' }, 's1'))).resolves.toBe(true);
  });

  it('404s when session is missing or inaccessible', async () => {
    accessSvc.resolveSession.mockResolvedValue(null);
    await expect(guard.canActivate(ctx({ id: 'u1' }, 's1'))).rejects.toThrow(NotFoundException);
  });

  it('returns 404 when userId is missing', async () => {
    await expect(guard.canActivate(ctx(undefined, 'x'))).rejects.toThrow(NotFoundException);
  });

  it('returns 404 when sessionId is missing', async () => {
    await expect(guard.canActivate(ctx({ id: 'u1' }, ''))).rejects.toThrow(NotFoundException);
  });
});
