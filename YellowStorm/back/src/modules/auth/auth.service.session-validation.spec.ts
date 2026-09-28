import { AuthService } from './auth.service';
import { makeSessionStoreFake, sessionRecord, type SessionStoreFake } from './persistence/session-store.fake';
import { ServiceUnavailableException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { isTransientSessionStoreError, classifySessionStoreError } from './utils/session-store-errors';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

/** pg-shaped error, as drizzle wraps it: SQLSTATE lives on err.cause.code. */
const wrappedPgError = (sqlState: string, message: string): Error =>
  new Error(`Failed query: select ...`, { cause: Object.assign(new Error(message), { code: sqlState }) });

describe('AuthService.isSessionValid error classification (F01)', () => {
  let sessionStore: SessionStoreFake;

  const build = (findByIdImpl: () => Promise<unknown>) => {
    sessionStore = makeSessionStoreFake();
    (sessionStore.findById as jest.Mock).mockImplementation(findByIdImpl);
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const service = new AuthService(
      sessionStore as never,
      {} as never,
      { sign: jest.fn() } as never,
      { get: jest.fn((_k: string, def: unknown) => def) } as never,
      logger as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getSettings: jest.fn().mockResolvedValue({ throttle: { limit: 100, windowSeconds: 60 }, auth: { maxSessionsPerUser: 10 }, documentUpload: { maxFileSizeMb: 50, maxFilesPerUpload: 10, allowedMimeTypes: [] } }) } as never, // platformSettings
      {} as never,
    );
    return { service };
  };

  const validSession = () => sessionRecord({ id: 's1', isValid: true, expiresAt: new Date(Date.now() + 60_000) });

  it('returns true for a valid session', async () => {
    const { service } = build(() => Promise.resolve(validSession()));
    await expect(service.isSessionValid('s1')).resolves.toBe(true);
  });

  it('returns false for an authoritatively missing session', async () => {
    const { service } = build(() => Promise.resolve(null));
    await expect(service.isSessionValid('s1')).resolves.toBe(false);
  });

  it('returns false for an invalidated session', async () => {
    const { service } = build(() =>
      Promise.resolve({ ...validSession(), isValid: false }),
    );
    await expect(service.isSessionValid('s1')).resolves.toBe(false);
  });

  it('returns false for an expired session', async () => {
    const { service } = build(() =>
      Promise.resolve({ ...validSession(), expiresAt: new Date(Date.now() - 60_000) }),
    );
    await expect(service.isSessionValid('s1')).resolves.toBe(false);
  });

  it.each([
    ['drizzle-wrapped 57P01', wrappedPgError('57P01', 'terminating connection due to administrator command')],
    ['drizzle-wrapped 08006', wrappedPgError('08006', 'connection failure')],
    ['terminated connection', new Error('Connection terminated unexpectedly')],
  ])('throws 503 AUTH_DEPENDENCY_UNAVAILABLE on transient store failure (%s)', async (_label, error) => {
    const { service } = build(() => Promise.reject(error));
    const promise = service.isSessionValid('s1');
    await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableException);
    await promise.catch((e) => {
      expect(e.code).toBe(ErrorCode.AUTH_DEPENDENCY_UNAVAILABLE);
      expect(e.getStatus()).toBe(503);
    });
  });

  it('rethrows unexpected store errors instead of reporting revocation', async () => {
    const boom = new TypeError('Cannot read properties of undefined');
    const { service } = build(() => Promise.reject(boom));
    await expect(service.isSessionValid('s1')).rejects.toBe(boom);
  });

  it('classifies pg-shaped transient errors through the cause chain', () => {
    expect(isTransientSessionStoreError(wrappedPgError('57P01', 'terminating connection'))).toBe(true);
    expect(isTransientSessionStoreError(wrappedPgError('08006', 'connection failure'))).toBe(true);
    expect(isTransientSessionStoreError(new Error('Cast to ObjectId failed'))).toBe(false);
  });

  it('classifySessionStoreError prefers the pg SQLSTATE code', () => {
    expect(classifySessionStoreError(wrappedPgError('57P01', 'terminating connection'))).toBe('57P01');
    expect(classifySessionStoreError(new TypeError('boom'))).toBe('TypeError');
    expect(classifySessionStoreError('nope')).toBe('UnknownSessionStoreError');
  });
});
