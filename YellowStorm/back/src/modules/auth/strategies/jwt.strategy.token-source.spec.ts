import * as jwt from 'jsonwebtoken';
import { JwtService } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { SseAuthGuard } from '../../notifications/guards/sse-auth.guard';
import { SseAuthGuard as ConversationStreamAuthGuard } from '../../conversation/guards/stream-auth.guard';
import { PlaybookFlowStreamAuthGuard } from '../../playbook-flow/guards/playbook-flow-stream-auth.guard';

const SECRET = 'test-secret-key-for-jwt-token-source-specs';
const ISSUER = 'test-issuer';
const AUDIENCE = 'test-audience';

const configService = {
  get: jest.fn((key: string) => ({ 'jwt.secret': SECRET, 'jwt.issuer': ISSUER, 'jwt.audience': AUDIENCE })[key]),
};

const claims = { sub: 'user-1', type: 'access', sessionId: 'session-1' };
const sign = (algorithm: jwt.Algorithm) =>
  jwt.sign(claims, SECRET, { algorithm, issuer: ISSUER, audience: AUDIENCE, expiresIn: 60 });

describe('JwtStrategy token source', () => {
  const run = async (request: Record<string, unknown>) => {
    const strategy = new JwtStrategy(configService as never, {} as never, {} as never, {} as never);
    const validate = jest.spyOn(strategy, 'validate').mockResolvedValue({ id: 'user-1' } as never);
    const outcome = await new Promise<'success' | 'fail'>((resolve) => {
      Object.assign(strategy, {
        success: () => { resolve('success'); },
        fail: () => { resolve('fail'); },
        error: () => { resolve('fail'); },
      });
      strategy.authenticate(request as never);
    });
    return { outcome, validate };
  };

  it('accepts a bearer token from the Authorization header', async () => {
    const { outcome, validate } = await run({
      headers: { authorization: `Bearer ${sign('HS256')}` },
      query: {},
    });

    expect(outcome).toBe('success');
    expect(validate).toHaveBeenCalled();
  });

  it('rejects a token supplied only in the query string on guarded routes', async () => {
    const { outcome, validate } = await run({ headers: {}, query: { token: sign('HS256') } });

    expect(outcome).toBe('fail');
    expect(validate).not.toHaveBeenCalled();
  });

  it('rejects tokens signed with an algorithm other than HS256', async () => {
    const { outcome, validate } = await run({
      headers: { authorization: `Bearer ${sign('HS512')}` },
      query: {},
    });

    expect(outcome).toBe('fail');
    expect(validate).not.toHaveBeenCalled();
  });
});

describe('query-token stream guards (EventSource routes)', () => {
  const jwtService = new JwtService({});
  const authService = { isSessionValid: jest.fn().mockResolvedValue(true) };
  const context = (token: string | undefined) => {
    const request: Record<string, unknown> = { query: { token } };
    return {
      request,
      ctx: { switchToHttp: () => ({ getRequest: () => request }) } as never,
    };
  };

  const guards: [string, () => { canActivate(ctx: never): Promise<boolean> }][] = [
    ['notifications SSE', () => new SseAuthGuard(jwtService, configService as never, authService as never)],
    [
      'conversation stream',
      () => new ConversationStreamAuthGuard(jwtService, configService as never, authService as never),
    ],
    [
      'playbook stream',
      () => new PlaybookFlowStreamAuthGuard(jwtService, configService as never, authService as never),
    ],
  ];

  it.each(guards)('%s guard accepts a valid HS256 query token', async (_name, make) => {
    const { ctx, request } = context(sign('HS256'));

    await expect(make().canActivate(ctx)).resolves.toBe(true);
    expect(request.sseUser).toMatchObject({ sub: 'user-1' });
  });

  it.each(guards)('%s guard rejects a missing token', async (_name, make) => {
    await expect(make().canActivate(context(undefined).ctx)).rejects.toMatchObject({ status: 401 });
  });

  it.each(guards)('%s guard rejects a non-HS256 token', async (_name, make) => {
    await expect(make().canActivate(context(sign('HS512')).ctx)).rejects.toMatchObject({
      code: 'ERR_1102',
    });
  });
});
