import { PlaybookExecutionSettingsResolverService } from './playbook-execution-settings-resolver.service';

describe('PlaybookExecutionSettingsResolverService', () => {
  it('keeps Dynamic Reasoning disabled when the deployment flag is off', async () => {
    const systemService = {
      getPlaybookSettings: jest.fn().mockResolvedValue({
        playbookExecution: {
          availableCapacity: 50,
          maxConcurrentPerUser: 10,
          maxConcurrentPerFlow: 5,
          maxConcurrentPerProvider: 25,
          maxConcurrentPerModel: 10,
          executionQueueMaxDepth: 50,
          maxParallelismPerExecution: 5,
          recursionLimitDefault: 25,
          recursionLimitMax: 50,
          maxHitlRounds: 5,
          pythonWorkerPoolSize: 8,
          pythonWorkerMaxInflight: 4,
          maxToolIterations: 40,
          graphCacheEnabled: false,
          graphCacheMaxEntries: 128,
          graphCacheTtlSeconds: 900,
          dynamicReasoning: { plannerAgentId: null, maxWorkNodes: 6, maxParallelism: 3, maxDepth: 1, maxRepairAttempts: 1 },
        },
      }),
    };
    const service = new PlaybookExecutionSettingsResolverService(systemService as never, {
      maxConcurrentGlobalExecutions: 50,
      maxConcurrentPerUser: 10,
      maxConcurrentPerFlow: 5,
      maxConcurrentPerProvider: 25,
      maxConcurrentPerModel: 10,
      executionQueueMaxDepth: 50,
      maxParallelismPerExecution: 5,
      recursionLimitDefault: 25,
      recursionLimitMax: 50,
      dynamicReasoningEnabled: false,
    } as never);

    expect((await service.resolve()).dynamicReasoningEnabled).toBe(false);
  });

  it('uses saved runtime limits instead of treating environment defaults as ceilings', async () => {
    const stored = {
      availableCapacity: 50,
      maxConcurrentPerUser: 20,
      maxConcurrentPerFlow: 5,
      maxConcurrentPerProvider: 25,
      maxConcurrentPerModel: 10,
      executionQueueMaxDepth: 200,
      maxParallelismPerExecution: 12,
      recursionLimitDefault: 80,
      recursionLimitMax: 100,
      maxHitlRounds: 9,
      pythonWorkerPoolSize: 12,
      pythonWorkerMaxInflight: 6,
      maxToolIterations: 90,
      graphCacheEnabled: true,
      graphCacheMaxEntries: 512,
      graphCacheTtlSeconds: 1800,
      dynamicReasoning: { plannerAgentId: null, maxWorkNodes: 6, maxParallelism: 3, maxDepth: 1, maxRepairAttempts: 1 },
    };
    const service = new PlaybookExecutionSettingsResolverService({
      getPlaybookSettings: jest.fn().mockResolvedValue({ playbookExecution: stored }),
    } as never, {
      maxConcurrentGlobalExecutions: 50,
      maxConcurrentPerUser: 10,
      executionQueueMaxDepth: 50,
      maxParallelismPerExecution: 5,
      recursionLimitDefault: 25,
      recursionLimitMax: 50,
      dynamicReasoningEnabled: true,
    } as never);

    expect(await service.resolve()).toMatchObject({
      maxConcurrentPerUser: 20,
      executionQueueMaxDepth: 200,
      maxParallelismPerExecution: 12,
      recursionLimitDefault: 80,
      recursionLimitMax: 100,
      maxToolIterations: 90,
      graphCacheEnabled: true,
    });
  });

  it('delegates planner model resolution with flow settings', async () => {
    const settingsService = {
      resolvePlaybookPlanner: jest.fn().mockResolvedValue({ model: 'resolved-model' }),
    };
    const service = new PlaybookExecutionSettingsResolverService({} as never, {} as never, settingsService as never);
    const flowSettings = { inferenceModelId: 'flow-model' };

    await expect(service.resolvePlanner('planner-1', flowSettings)).resolves.toEqual({ model: 'resolved-model' });
    expect(settingsService.resolvePlaybookPlanner).toHaveBeenCalledWith('planner-1', flowSettings);
  });
});
