import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WORKY_EVENT_ID_HEADER,
  WORKY_SERVICE_TOKEN_HEADER,
  WorkyServiceAuthGuard,
} from './worky-service-auth.guard';

function ctx(headers: Record<string, string | undefined>): ExecutionContext {
  const norm = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v as string | string[] | undefined]),
  );
  const req: { headers: Record<string, string | string[] | undefined> } = { headers: norm };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('WorkyServiceAuthGuard', () => {
  const expected = 'super-secret-token-1234567890';

  const makeGuard = (token: string | undefined) => {
    const config = {
      get: jest.fn((key: string) => (key === 'worky.serviceToken' ? token : '')),
    } as unknown as ConfigService;
    return new WorkyServiceAuthGuard(config);
  };

  it('passes when the X-Service-Token header matches the configured token', () => {
    const guard = makeGuard(expected);
    expect(
      guard.canActivate(ctx({ [WORKY_SERVICE_TOKEN_HEADER]: expected })),
    ).toBe(true);
  });

  it('rejects when the token is missing', () => {
    const guard = makeGuard(expected);
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it('rejects when the token does not match', () => {
    const guard = makeGuard(expected);
    expect(() =>
      guard.canActivate(ctx({ [WORKY_SERVICE_TOKEN_HEADER]: 'wrong' })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when WORKY_SERVICE_TOKEN is not configured on the server', () => {
    const guard = makeGuard(undefined);
    expect(() =>
      guard.canActivate(ctx({ [WORKY_SERVICE_TOKEN_HEADER]: 'whatever' })),
    ).toThrow(UnauthorizedException);
  });

  it('exports the canonical header names', () => {
    expect(WORKY_SERVICE_TOKEN_HEADER).toBe('x-service-token');
    expect(WORKY_EVENT_ID_HEADER).toBe('x-event-id');
  });
});
