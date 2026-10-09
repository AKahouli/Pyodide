import type { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import {
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
} from '../decorators/require-permissions.decorator';
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
  return new PermissionsGuard(makeReflector(meta) as never);
}

describe('PermissionsGuard', () => {
  it('allows when no permissions are required', () => {
    expect(guard({}).canActivate(makeContext({ permissions: [] }))).toBe(true);
  });

  it('enforces permissions even without a JWT user (fail-closed) — local usage', () => {
    // Base guard does NOT special-case @Public; it always enforces when a
    // permission requirement is present so explicit local usages keep working.
    const g = guard({ [PERMISSIONS_KEY]: ['semantic_models.read'] });
    expect(() => g.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  it('denies (fail-closed) when permissions are required but there is no user', () => {
    const g = guard({ [PERMISSIONS_KEY]: ['users.read'] });
    expect(() => g.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  it('mode "all" requires every permission', () => {
    const g = guard({
      [PERMISSIONS_KEY]: ['a.one', 'a.two'],
      [PERMISSIONS_MODE_KEY]: 'all',
    });
    expect(
      g.canActivate(makeContext({ permissions: ['a.one', 'a.two'] })),
    ).toBe(true);
    expect(() =>
      g.canActivate(makeContext({ permissions: ['a.one'] })),
    ).toThrow(ForbiddenException);
  });

  it('mode "any" requires at least one permission', () => {
    const g = guard({
      [PERMISSIONS_KEY]: ['a.one', 'a.two'],
      [PERMISSIONS_MODE_KEY]: 'any',
    });
    expect(
      g.canActivate(makeContext({ permissions: ['a.two'] })),
    ).toBe(true);
    expect(() =>
      g.canActivate(makeContext({ permissions: ['b.x'] })),
    ).toThrow(ForbiddenException);
  });

  it('grants super admin (*) access', () => {
    const g = guard({ [PERMISSIONS_KEY]: ['users.suspend'] });
    expect(g.canActivate(makeContext({ permissions: ['*'] }))).toBe(true);
  });

  it('supports deep wildcards', () => {
    const g = guard({ [PERMISSIONS_KEY]: ['worky.stream.write'] });
    expect(g.canActivate(makeContext({ permissions: ['worky.*'] }))).toBe(true);
  });
});
