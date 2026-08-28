import { normalizePlaybookExecutionSettings } from './playbook-settings.interface';

describe('normalizePlaybookExecutionSettings', () => {
  it('clamps dependent execution limits consistently', () => {
    const result = normalizePlaybookExecutionSettings({
      availableCapacity: 4,
      maxConcurrentPerUser: 10,
      maxConcurrentPerFlow: 8,
      recursionLimitDefault: 100,
      recursionLimitMax: 20,
      maxParallelismPerExecution: 3,
      dynamicReasoning: { plannerAgentId: '507f1f77bcf86cd799439011', maxWorkNodes: 2, maxParallelism: 9, maxDepth: 4, maxRepairAttempts: 9 },
    });
    expect(result.maxConcurrentPerUser).toBe(4);
    expect(result.maxConcurrentPerFlow).toBe(4);
    expect(result.recursionLimitDefault).toBe(20);
    expect(result.dynamicReasoning).toEqual({
      plannerAgentId: '507f1f77bcf86cd799439011',
      maxWorkNodes: 2,
      maxParallelism: 2,
      maxDepth: 1,
      maxRepairAttempts: 3,
    });
  });

  it('normalizes a missing planner selection to null', () => {
    const result = normalizePlaybookExecutionSettings();
    expect(result.dynamicReasoning.plannerAgentId).toBeNull();
    expect(result).toMatchObject({
      maxHitlRounds: 5,
      pythonWorkerPoolSize: 8,
      pythonWorkerMaxInflight: 4,
      maxToolIterations: 40,
      graphCacheEnabled: false,
      graphCacheMaxEntries: 128,
      graphCacheTtlSeconds: 900,
    });
  });

  it('bounds dynamic runtime settings', () => {
    expect(normalizePlaybookExecutionSettings({
      maxHitlRounds: 1000,
      pythonWorkerPoolSize: 0,
      pythonWorkerMaxInflight: 100,
      maxToolIterations: 0,
      graphCacheEnabled: true,
      graphCacheMaxEntries: 20000,
      graphCacheTtlSeconds: 0,
    })).toMatchObject({
      maxHitlRounds: 100,
      pythonWorkerPoolSize: 1,
      pythonWorkerMaxInflight: 20,
      maxToolIterations: 1,
      graphCacheEnabled: true,
      graphCacheMaxEntries: 10000,
      graphCacheTtlSeconds: 1,
    });
  });
});
