import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppBuilderSessionPermissions } from '../constants/app-builder-session-permissions';
import { AppBuilderSessionAccessGuard } from './app-builder-session-access.guard';

interface GuardRequest {
  user?: { id: string };
  params: { id: string };
  appBuilderAccess?: unknown;
  appBuilderSession?: unknown;
}

function ctx(user: { id: string } | undefined, id: string): ExecutionContext {
  const req: GuardRequest = { user, params: { id } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const requestOf = (execution: ExecutionContext) =>
  execution.switchToHttp().getRequest() as GuardRequest;

const resolvedSession = (
  permissions: string[],
  viewerRole: 'owner' | 'shared' = 'owner',
) => ({
  pointer: { aiSessionId: 'ai-1' },
  ownerId: 'u1',
  actorUserId: 'u1',
  access: { sessionId: 's1', viewerRole, permissions },
});

describe('AppBuilderSessionAccessGuard', () => {
  const access = { resolveSession: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new AppBuilderSessionAccessGuard(
    reflector as unknown as Reflector,
    access as never,
  );

  beforeEach(() => {
    access.resolveSession.mockReset();
    reflector.getAllAndOverride.mockReturnValue(AppBuilderSessionPermissions.SESSION_READ);
  });

  it('allows owner with session.read and attaches access', async () => {
    access.resolveSession.mockResolvedValueOnce(
      resolvedSession([AppBuilderSessionPermissions.SESSION_READ]),
    );
    const execution = ctx({ id: 'u1' }, 's1');

    await expect(guard.canActivate(execution)).resolves.toBe(true);
    expect(requestOf(execution).appBuilderAccess).toBeDefined();
  });

  /**
   * `@CurrentAppBuilderSession()` reads `appBuilderSession` and 404s when
   * it is missing, so every route behind this guard breaks if the pointer is
   * dropped — which unit tests calling handlers directly cannot catch.
   */
  it('attaches the resolved session so @CurrentAppBuilderSession() can read the pointer', async () => {
    access.resolveSession.mockResolvedValueOnce(
      resolvedSession([AppBuilderSessionPermissions.SESSION_READ]),
    );
    const execution = ctx({ id: 'u1' }, 's1');

    await guard.canActivate(execution);

    expect(requestOf(execution).appBuilderSession).toMatchObject({
      pointer: { aiSessionId: 'ai-1' },
      ownerId: 'u1',
    });
  });

  it('404s when required permission is missing', async () => {
    reflector.getAllAndOverride.mockReturnValue(AppBuilderSessionPermissions.STREAM_WRITE);
    access.resolveSession.mockResolvedValueOnce(
      resolvedSession([AppBuilderSessionPermissions.SESSION_READ], 'shared'),
    );

    await expect(guard.canActivate(ctx({ id: 'u2' }, 's1'))).rejects.toThrow(NotFoundException);
  });

  it('404s when access cannot be resolved', async () => {
    access.resolveSession.mockResolvedValueOnce(null);
    await expect(guard.canActivate(ctx({ id: 'u2' }, 's1'))).rejects.toThrow(NotFoundException);
  });
});
