import { pgAvailable } from './pg-integration';

describe('Postgres integration test isolation', () => {
  it('requires a dedicated database distinct from the application database', () => {
    expect(pgAvailable({ POSTGRES_HOST: 'localhost', POSTGRES_DB: 'app' })).toBe(false);
    expect(pgAvailable({
      POSTGRES_HOST: 'localhost',
      POSTGRES_DB: 'app',
      POSTGRES_TEST_DB: 'app',
    })).toBe(false);
    expect(pgAvailable({
      POSTGRES_HOST: 'localhost',
      POSTGRES_DB: 'app',
      POSTGRES_TEST_DB: 'app_test',
    })).toBe(true);
  });
});
