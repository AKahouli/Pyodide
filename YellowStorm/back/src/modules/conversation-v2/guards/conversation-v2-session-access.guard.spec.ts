import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConversationV2SessionPermissions } from '../constants/conversation-v2-session-permissions';
import { ConversationV2SessionAccessGuard } from './conversation-v2-session-access.guard';

function ctx(user: { id: string } | undefined, id: string): ExecutionContext {
  const req: {
    user?: { id: string };
    params: { id: string };
    conversationV2Access?: unknown;
  } = { user, params: { id } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('ConversationV2SessionAccessGuard', () => {
  const access = { resolve: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new ConversationV2SessionAccessGuard(
    reflector as unknown as Reflector,
    access as never,
  );

  beforeEach(() => {
    access.resolve.mockReset();
    reflector.getAllAndOverride.mockReturnValue(ConversationV2SessionPermissions.SESSION_READ);
  });

  it('allows owner with session.read and attaches access', async () => {
    access.resolve.mockResolvedValueOnce({
      sessionId: 's1',
      viewerRole: 'owner',
      permissions: [ConversationV2SessionPermissions.SESSION_READ],
    });
    const execution = ctx({ id: 'u1' }, 's1');
    await expect(guard.canActivate(execution)).resolves.toBe(true);
    expect(
      (execution.switchToHttp().getRequest() as { conversationV2Access?: unknown })
        .conversationV2Access,
    ).toBeDefined();
  });

  it('404s when required permission is missing', async () => {
    reflector.getAllAndOverride.mockReturnValue(ConversationV2SessionPermissions.STREAM_WRITE);
    access.resolve.mockResolvedValueOnce({
      sessionId: 's1',
      viewerRole: 'shared',
      permissions: [ConversationV2SessionPermissions.SESSION_READ],
    });
    await expect(guard.canActivate(ctx({ id: 'u2' }, 's1'))).rejects.toThrow(NotFoundException);
  });

  it('404s when access cannot be resolved', async () => {
    access.resolve.mockResolvedValueOnce(null);
    await expect(guard.canActivate(ctx({ id: 'u2' }, 's1'))).rejects.toThrow(NotFoundException);
  });
});
