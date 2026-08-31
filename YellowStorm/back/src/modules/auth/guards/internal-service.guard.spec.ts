import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalServiceGuard } from './internal-service.guard';

function ctx(headers: Record<string, string | undefined>): ExecutionContext {
  const norm = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const req: { headers: Record<string, string | undefined> } = { headers: norm };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('InternalServiceGuard', () => {
  const expected = 'internal-secret-token-abcdef';

  const makeGuard = (secret: string) => {
    const config = {
      get: jest.fn((key: string, fallback = '') =>
        key === 'INTERNAL_SERVICE_SECRET' ? secret : fallback,
      ),
    } as unknown as ConfigService;
    return new InternalServiceGuard(config);
  };

  it('passes when X-Internal-Token matches the configured secret', () => {
    const guard = makeGuard(expected);
    expect(guard.canActivate(ctx({ 'x-internal-token': expected }))).toBe(true);
  });

  it('rejects with UnauthorizedException when the token header is missing', () => {
    const guard = makeGuard(expected);
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({}))).toThrow(/Missing internal service token/);
  });

  it('rejects when the token header is empty', () => {
    const guard = makeGuard(expected);
    expect(() => guard.canActivate(ctx({ 'x-internal-token': '' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when the token does not match', () => {
    const guard = makeGuard(expected);
    expect(() =>
      guard.canActivate(ctx({ 'x-internal-token': 'wrong-token-value!!!!!' })),
    ).toThrow(UnauthorizedException);
  });

  it('fail-closes when INTERNAL_SERVICE_SECRET is not configured', () => {
    const guard = makeGuard('');
    expect(() =>
      guard.canActivate(ctx({ 'x-internal-token': 'whatever' })),
    ).toThrow(UnauthorizedException);
  });
});
