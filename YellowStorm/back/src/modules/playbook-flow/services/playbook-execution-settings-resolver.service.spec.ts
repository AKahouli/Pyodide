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
});
