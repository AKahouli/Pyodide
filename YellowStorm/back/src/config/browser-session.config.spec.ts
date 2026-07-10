import browserSessionConfig from './browser-session.config';

describe('browserSessionConfig', () => {
  it('provides POC defaults', () => {
    const c = browserSessionConfig();
    expect(c.idleMs).toBe(300000);
    expect(c.maxMs).toBe(1200000);
    expect(c.maxConcurrent).toBe(5);
    expect(c.viewportWidth).toBe(1280);
    expect(c.viewportHeight).toBe(800);
    expect(c.screencastQuality).toBe(60);
  });

  it('reads overrides from env', () => {
    process.env.BROWSER_SESSION_MAX_CONCURRENT = '2';
    expect(browserSessionConfig().maxConcurrent).toBe(2);
    delete process.env.BROWSER_SESSION_MAX_CONCURRENT;
  });
});
