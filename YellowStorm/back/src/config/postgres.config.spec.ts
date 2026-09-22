import postgresConfig from './postgres.config';

describe('postgresConfig', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('falls back to local dev defaults when env is unset', () => {
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_PORT;
    delete process.env.POSTGRES_DB;
    const cfg = postgresConfig();
    expect(cfg.host).toBe('localhost');
    expect(cfg.port).toBe(5432);
    expect(cfg.database).toBe('yellostorm');
    expect(cfg.ssl).toBe(false);
    expect(cfg.maxPoolSize).toBe(10);
  });

  it('reads values from environment', () => {
    process.env.POSTGRES_HOST = 'db.internal';
    process.env.POSTGRES_PORT = '6543';
    process.env.POSTGRES_DB = 'agents';
    process.env.POSTGRES_SSL = 'true';
    process.env.POSTGRES_MAX_POOL_SIZE = '25';
    const cfg = postgresConfig();
    expect(cfg.host).toBe('db.internal');
    expect(cfg.port).toBe(6543);
    expect(cfg.database).toBe('agents');
    expect(cfg.ssl).toBe(true);
    expect(cfg.maxPoolSize).toBe(25);
  });

  it('defaults keepalive delay and leaves SSL verification unset', () => {
    delete process.env.POSTGRES_KEEPALIVE_INITIAL_DELAY;
    delete process.env.POSTGRES_SSL_CA;
    delete process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED;
    const cfg = postgresConfig();
    expect(cfg.keepAliveInitialDelayMs).toBe(10000);
    expect(cfg.sslCa).toBeUndefined();
    expect(cfg.sslRejectUnauthorized).toBeUndefined();
  });

  it('reads SSL CA and verification flag', () => {
    process.env.POSTGRES_SSL_CA = '/etc/ssl/pg-ca.pem';
    process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED = 'false';
    const cfg = postgresConfig();
    expect(cfg.sslCa).toBe('/etc/ssl/pg-ca.pem');
    expect(cfg.sslRejectUnauthorized).toBe(false);
  });
});
