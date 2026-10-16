import { ExecutionContext } from '@nestjs/common';
import { BadRequestException } from '@modules/exceptions';
import { PyodideActorGuard, pyodideActingUserIdFrom } from './pyodide-actor.guard';

function contextWith(headers: Record<string, string | string[] | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('PyodideActorGuard', () => {
  const guard = new PyodideActorGuard();
  const userId = '65f000000000000000000001';

  it('accepts a trusted ObjectId acting user', () => {
    expect(guard.canActivate(contextWith({ 'x-yellowstorm-user-id': userId }))).toBe(true);
    expect(pyodideActingUserIdFrom({ 'x-yellowstorm-user-id': userId })).toBe(userId);
  });

  it('rejects a missing or non-ObjectId acting user', () => {
    expect(() => guard.canActivate(contextWith({}))).toThrow(BadRequestException);
    expect(() => guard.canActivate(contextWith({ 'x-yellowstorm-user-id': 'user-1' }))).toThrow(BadRequestException);
  });

  it('rejects an over-long correlation id', () => {
    expect(() => guard.canActivate(contextWith({
      'x-yellowstorm-user-id': userId,
      'x-correlation-id': 'c'.repeat(201),
    }))).toThrow(BadRequestException);
  });
});
