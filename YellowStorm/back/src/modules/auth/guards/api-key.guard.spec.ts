import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';

const makeContext = (headers: Record<string, string | undefined>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

const makeGuard = (configuredKey: string): ApiKeyGuard =>
  new ApiKeyGuard({
    get: (_key: string, fallback = '') => configuredKey || fallback,
  } as never);

describe('ApiKeyGuard', () => {
  it('allows a request carrying the correct api key', () => {
    const guard = makeGuard('secret-key');
    expect(guard.canActivate(makeContext({ 'x-api-key': 'secret-key' }))).toBe(true);
  });

  it('rejects a request with a wrong api key', () => {
    const guard = makeGuard('secret-key');
    expect(() => guard.canActivate(makeContext({ 'x-api-key': 'wrong-key' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with no api key', () => {
    const guard = makeGuard('secret-key');
    expect(() => guard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
  });

  it('fails closed when no key is configured', () => {
    const guard = makeGuard('');
    expect(() => guard.canActivate(makeContext({ 'x-api-key': 'anything' }))).toThrow(
      UnauthorizedException,
    );
  });
});
