import { AuthService } from './auth.service';
import { ServiceUnavailableException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { isTransientSessionStoreError } from './utils/session-store-errors';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('AuthService.isSessionValid error classification (F01)', () => {
  const makeSessionModel = () => {
    const model: any = jest.fn().mockImplementation(() => ({
      save: jest.fn().mockResolvedValue(undefined),
    }));
    model.findById = jest.fn();
    model.countDocuments = jest.fn().mockResolvedValue(0);
    model.find = jest.fn().mockReturnValue({
      sort: () => ({ limit: () => ({ exec: jest.fn().mockResolvedValue([]) }) }),
    });
    model.findOne = jest.fn().mockResolvedValue(null);
    model.deleteOne = jest.fn();
    model.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    return model;
  };

  const build = (findByIdImpl: () => Promise<unknown>) => {
    const sessionModel = makeSessionModel();
    sessionModel.findById.mockImplementation(findByIdImpl);
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const service = new AuthService(
      sessionModel as never,
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
      {} as never,
    );
    return { service, sessionModel };
  };

  const validSession = () => ({
    isValid: true,
    expiresAt: new Date(Date.now() + 60_000),
  });

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
      Promise.resolve({ isValid: false, expiresAt: new Date(Date.now() + 60_000) }),
    );
    await expect(service.isSessionValid('s1')).resolves.toBe(false);
  });

  it('returns false for an expired session', async () => {
    const { service } = build(() =>
      Promise.resolve({ isValid: true, expiresAt: new Date(Date.now() - 60_000) }),
    );
    await expect(service.isSessionValid('s1')).resolves.toBe(false);
  });

  it.each([
    ['server selection timeout', Object.assign(new Error('connection timed out'), { name: 'MongoServerSelectionError' })],
    ['network error', Object.assign(new Error('connection closed'), { name: 'MongoNetworkError' })],
    ['topology destroyed', Object.assign(new Error('topology was destroyed'), { name: 'MongoTopologyClosedError' })],
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

  it('classifies transient driver errors by name/code/message', () => {
    expect(
      isTransientSessionStoreError(Object.assign(new Error('Server selection timed out after 30000 ms'), { name: 'MongoServerSelectionError' })),
    ).toBe(true);
    expect(isTransientSessionStoreError(Object.assign(new Error('EpilogueError'), { code: 6 }))).toBe(true);
    expect(isTransientSessionStoreError(new Error('Cast to ObjectId failed'))).toBe(false);
  });
});
