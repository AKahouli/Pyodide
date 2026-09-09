import { isTransientConnectionError } from './transient-connection-error';

describe('isTransientConnectionError', () => {
  it.each([
    'Connection terminated unexpectedly',
    'Connection terminated',
    'Connection error: socket hang up',
  ])('matches pg connection termination message "%s"', (message) => {
    expect(isTransientConnectionError(new Error(message))).toBe(true);
  });

  it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'])(
    'matches system error code %s set on the error',
    (code) => {
      const error = new Error('read failed') as NodeJS.ErrnoException;
      error.code = code;
      expect(isTransientConnectionError(error)).toBe(true);
    },
  );

  it('matches Postgres admin shutdown (57P01) surfaced in the message', () => {
    expect(isTransientConnectionError(new Error('terminating connection due to administrator command (57P01)'))).toBe(
      true,
    );
  });

  it('matches database still starting up', () => {
    expect(isTransientConnectionError(new Error('the database system is starting up'))).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isTransientConnectionError(new Error('relation "foo" does not exist'))).toBe(false);
    expect(isTransientConnectionError(new Error('syntax error at or near "SELECT"'))).toBe(false);
  });

  it('does not match non-error values', () => {
    expect(isTransientConnectionError('ECONNRESET')).toBe(false);
    expect(isTransientConnectionError(null)).toBe(false);
    expect(isTransientConnectionError(undefined)).toBe(false);
  });
});
