import { JwtService } from '@nestjs/jwt';
import { SseAuthGuard } from './stream-auth.guard';
const secret = 'sse-test-secret';
const jwt = new JwtService({ secret, signOptions: { issuer: 'issuer', audience: 'audience', algorithm: 'HS256' } });
const auth = { isSessionValid: jest.fn().mockResolvedValue(true) };
const config = { get: (key: string) => ({ 'jwt.secret': secret, 'jwt.issuer': 'issuer', 'jwt.audience': 'audience' })[key] };
const guard = new SseAuthGuard(jwt, config as never, auth as never);
const claims = { sub: 'u', type: 'access', sessionId: 's' };
const context = (headers = {}, query = {}, originalUrl = '/api/v1/conversations/stream') => {
  const request = { headers, query, originalUrl };
  return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as never };
};
describe('classic SSE Authorization', () => {
  beforeEach(() => auth.isSessionValid.mockResolvedValue(true));
  it('accepts active-session bearer and normalizes actor', async () => {
    const { request, ctx } = context({ authorization: `Bearer ${jwt.sign(claims)}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request).toMatchObject({ sseUser: { sub: 'u', id: 'u' } });
  });
  it('rejects query JWT for classic streams', async () => {
    await expect(guard.canActivate(context({}, { token: jwt.sign(claims) }).ctx)).rejects.toMatchObject({ status: 401 });
  });
  it('retains v2 query transport only', async () => {
    await expect(guard.canActivate(context({}, { token: jwt.sign(claims) }, '/api/v1/conversation-v2/stream').ctx)).resolves.toBe(true);
  });
  it.each([
    jwt.sign({ ...claims, type: 'refresh' }), jwt.sign(claims, { issuer: 'foreign' }),
    jwt.sign(claims, { audience: 'foreign' }), jwt.sign(claims, { algorithm: 'HS512' }), jwt.sign(claims, { expiresIn: -1 }),
  ])('rejects invalid claims and algorithm', async token => {
    await expect(guard.canActivate(context({ authorization: `Bearer ${token}` }).ctx)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects revoked sessions and propagates store outages', async () => {
    const { ctx } = context({ authorization: `Bearer ${jwt.sign(claims)}` });
    auth.isSessionValid.mockResolvedValueOnce(false);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
    auth.isSessionValid.mockRejectedValueOnce(new Error('store unavailable'));
    await expect(guard.canActivate(ctx)).rejects.toThrow('store unavailable');
  });
});
