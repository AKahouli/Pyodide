import { AppDataMigrationService } from './app-data-migration.service';

describe('AppDataMigrationService.applyPlan statement timeout', () => {
  function build(timeoutMs: unknown) {
    const client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const config = { get: jest.fn().mockReturnValue(timeoutMs) };
    const catalog = {
      getEnvironment: jest.fn().mockResolvedValue({ id: 'env-1', currentVersion: 1 }),
    };
    const diff = { overallClassification: jest.fn().mockReturnValue('additive') };
    const policies = { ensureDevDefaultPolicies: jest.fn() };
    const locks = {
      withLock: jest.fn((_id: string, _env: string, fn: (c: unknown) => Promise<unknown>) => fn(client)),
    };
    const audit = { record: jest.fn() };
    const service = new AppDataMigrationService(
      {} as never,
      config as never,
      catalog as never,
      diff as never,
      policies as never,
      locks as never,
      audit as never,
    );
    return { service, client };
  }

  const params = {
    appId: 'app',
    appDataId: 'ad',
    workspaceId: 'ws',
    environment: 'staging' as never,
    schemaName: 'app_schema',
    plan: {
      fromVersion: 1,
      toVersion: 2,
      hasDestructive: false,
      operations: [{ kind: 'drop_index', table: 't', index: 'i' }],
    } as never,
    targetManifest: { version: 2, tables: {} } as never,
    manifestHash: 'h',
    expectedVersion: 1,
  };

  it('sets statement_timeout via set_config (no bind params in SET)', async () => {
    const { service, client } = build(12_345.7);
    await service.applyPlan(params).catch(() => undefined);
    const calls = client.query.mock.calls as unknown[][];
    const texts = calls.map((c) => String(c[0]));
    expect(texts.some((t) => /^SET\b.*\$\d/.test(t))).toBe(false);
    const call = calls.find((c) => String(c[0]).includes('set_config'));
    expect(call).toEqual(["SELECT set_config('statement_timeout', $1, true)", ['12345']]);
  });

  it('clamps invalid timeouts to at least 1ms', async () => {
    const { service, client } = build(0);
    await service.applyPlan(params).catch(() => undefined);
    const call = (client.query.mock.calls as unknown[][]).find((c) => String(c[0]).includes('set_config'));
    expect(call?.[1]).toEqual(['1']);
  });
});
