import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import playbookFlowConfig from '@config/playbook-flow.config';
import { SystemService } from '@modules/system/system.service';
import type { PlaybookExecutionAdminSettings } from '@modules/system/interfaces/playbook-settings.interface';

export interface EffectivePlaybookExecutionSettings extends PlaybookExecutionAdminSettings {
  dynamicReasoningEnabled: boolean;
  effectiveExecutionParallelism: number;
}

@Injectable()
export class PlaybookExecutionSettingsResolverService {
  constructor(
    private readonly systemService: SystemService,
    @Inject(playbookFlowConfig.KEY)
    private readonly config: ConfigType<typeof playbookFlowConfig>,
  ) {}

  async resolve(flowSettings?: { recursionLimit?: number; maxParallelism?: number }): Promise<EffectivePlaybookExecutionSettings> {
    const stored = (await this.systemService.getPlaybookSettings()).playbookExecution;
    const availableCapacity = Math.min(stored.availableCapacity, this.config.maxConcurrentGlobalExecutions);
    const maxParallelismPerExecution = Math.min(stored.maxParallelismPerExecution, this.config.maxParallelismPerExecution);
    const effectiveExecutionParallelism = Math.min(
      Math.max(1, flowSettings?.maxParallelism ?? maxParallelismPerExecution),
      maxParallelismPerExecution,
    );
    const recursionLimitMax = Math.min(stored.recursionLimitMax, this.config.recursionLimitMax);

    return {
      ...stored,
      availableCapacity,
      maxConcurrentPerUser: Math.min(stored.maxConcurrentPerUser, this.config.maxConcurrentPerUser, availableCapacity),
      maxConcurrentPerFlow: Math.min(stored.maxConcurrentPerFlow, this.config.maxConcurrentPerFlow, availableCapacity),
      maxConcurrentPerProvider: Math.min(stored.maxConcurrentPerProvider, this.config.maxConcurrentPerProvider, availableCapacity),
      maxConcurrentPerModel: Math.min(stored.maxConcurrentPerModel, this.config.maxConcurrentPerModel, availableCapacity),
      executionQueueMaxDepth: Math.min(stored.executionQueueMaxDepth, this.config.executionQueueMaxDepth),
      maxParallelismPerExecution,
      effectiveExecutionParallelism,
      recursionLimitDefault: Math.min(stored.recursionLimitDefault, this.config.recursionLimitDefault, recursionLimitMax),
      recursionLimitMax,
      dynamicReasoningEnabled: this.config.dynamicReasoningEnabled,
      dynamicReasoning: {
        ...stored.dynamicReasoning,
        maxParallelism: Math.min(stored.dynamicReasoning.maxParallelism, effectiveExecutionParallelism),
        maxDepth: 1,
      },
    };
  }
}
