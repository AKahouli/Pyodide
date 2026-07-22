import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { ConversationV2ReadAccessGuard } from './conversation-v2-read-access.guard';

function ctx(user: { id: string } | undefined, id: string): ExecutionContext {
  const req: { user?: { id: string }; params: { id: string } } = {
    user,
    params: { id },
  };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('ConversationV2ReadAccessGuard', () => {
  const sessions = { getById: jest.fn() };
  const appShares = { hasConversationAccess: jest.fn() };
  const guard = new ConversationV2ReadAccessGuard(sessions as never, appShares as never);

  beforeEach(() => {
    sessions.getById.mockReset();
    appShares.hasConversationAccess.mockReset();
  });

  it('allows the session owner', async () => {
    sessions.getById.mockResolvedValueOnce({ ownerId: 'u1' });
    await expect(guard.canActivate(ctx({ id: 'u1' }, 's1'))).resolves.toBe(true);
    expect(appShares.hasConversationAccess).not.toHaveBeenCalled();
  });

  it('allows a share recipient with conversation access', async () => {
    sessions.getById.mockResolvedValueOnce({ ownerId: 'owner-1' });
    appShares.hasConversationAccess.mockResolvedValueOnce(true);
    await expect(guard.canActivate(ctx({ id: 'u2' }, 's1'))).resolves.toBe(true);
  });

  it('404s when the viewer has no conversation share', async () => {
    sessions.getById.mockResolvedValueOnce({ ownerId: 'owner-1' });
    appShares.hasConversationAccess.mockResolvedValueOnce(false);
    await expect(guard.canActivate(ctx({ id: 'u2' }, 's1'))).rejects.toThrow(NotFoundException);
  });

  it('404s when the session is missing', async () => {
    sessions.getById.mockResolvedValueOnce(null);
    await expect(guard.canActivate(ctx({ id: 'u1' }, 's1'))).rejects.toThrow(NotFoundException);
  });
});
