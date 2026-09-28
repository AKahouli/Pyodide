import { PlaybookExecutionSettingsResolverService } from './playbook-execution-settings-resolver.service';
import { DEFAULT_PLAYBOOK_EXECUTION_SETTINGS } from '@modules/system/interfaces/playbook-settings.interface';

const baseStored = () => ({
  ...DEFAULT_PLAYBOOK_EXECUTION_SETTINGS,
  dynamicReasoning: { plannerAgentId: null, maxWorkNodes: 6, maxParallelism: 3, maxDepth: 1, maxRepairAttempts: 1 },
});

describe('PlaybookExecutionSettingsResolverService', () => {
  it('keeps Dynamic Reasoning disabled when the admin setting is off', async () => {
    const systemService = {
      getPlaybookSettings: jest.fn().mockResolvedValue({
        playbookExecution: { ...baseStored(), dynamicReasoningEnabled: false },
      }),
    };

    const service = new PlaybookExecutionSettingsResolverService(systemService as never);

    expect((await service.resolve()).dynamicReasoningEnabled).toBe(false);
  });

  it('uses saved runtime limits as the authoritative values', async () => {
    const stored = {
      ...baseStored(),
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
      maxSandboxCallsPerStep: 16,
      graphCacheEnabled: true,
      graphCacheMaxEntries: 512,
      graphCacheTtlSeconds: 1800,
      dynamicReasoningEnabled: true,
    };
    const service = new PlaybookExecutionSettingsResolverService({
      getPlaybookSettings: jest.fn().mockResolvedValue({ playbookExecution: stored }),
    } as never);

    expect(await service.resolve()).toMatchObject({
      maxConcurrentPerUser: 20,
      executionQueueMaxDepth: 200,
      maxParallelismPerExecution: 12,
      recursionLimitDefault: 80,
      recursionLimitMax: 100,
      maxToolIterations: 90,
      maxSandboxCallsPerStep: 16,
      graphCacheEnabled: true,
    });
  });

  it('delegates planner model resolution with flow settings', async () => {
    const settingsService = {
      resolvePlaybookPlanner: jest.fn().mockResolvedValue({ model: 'resolved-model' }),
    };
    const service = new PlaybookExecutionSettingsResolverService({} as never, settingsService as never);
    const flowSettings = { inferenceModelId: 'flow-model' };

    await expect(service.resolvePlanner('planner-1', flowSettings)).resolves.toEqual({ model: 'resolved-model' });
    expect(settingsService.resolvePlaybookPlanner).toHaveBeenCalledWith('planner-1', flowSettings);
  });
});
