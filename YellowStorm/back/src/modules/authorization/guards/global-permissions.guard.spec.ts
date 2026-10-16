import type { ExecutionContext } from '@nestjs/common';
import { GlobalPermissionsGuard } from './global-permissions.guard';
import {
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
} from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { ForbiddenException } from '../../exceptions';

function makeContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeReflector(meta: Record<string, unknown>) {
  return {
    getAllAndOverride: (key: string) => meta[key],
  };
}

function guard(meta: Record<string, unknown>) {
  return new GlobalPermissionsGuard(makeReflector(meta) as never);
}

describe('GlobalPermissionsGuard (app-wide)', () => {
  it('skips @Public routes (no request.user) so internal surfaces are not 403d', () => {
    const g = guard({
      [IS_PUBLIC_KEY]: true,
      [PERMISSIONS_KEY]: ['semantic_models.read'],
    });
    expect(g.canActivate(makeContext(undefined))).toBe(true);
  });

  it('allows non-public routes without a permission requirement', () => {
    expect(guard({}).canActivate(makeContext({ permissions: [] }))).toBe(true);
  });

  it('enforces the requirement on non-public routes (403 for an unprivileged user)', () => {
    const g = guard({ [PERMISSIONS_KEY]: ['users.read'] });
    expect(() => g.canActivate(makeContext({ permissions: [] }))).toThrow(
      ForbiddenException,
    );
  });

  it('grants access to a permitted user', () => {
    const g = guard({
      [PERMISSIONS_KEY]: ['users.read'],
      [PERMISSIONS_MODE_KEY]: 'all',
    });
    expect(g.canActivate(makeContext({ permissions: ['users.*'] }))).toBe(true);
  });

  it('grants super admin (*) on non-public routes', () => {
    const g = guard({ [PERMISSIONS_KEY]: ['users.suspend'] });
    expect(g.canActivate(makeContext({ permissions: ['*'] }))).toBe(true);
  });
});
