import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import playbookFlowConfig from '@config/playbook-flow.config';
import { SystemService } from '@modules/system/system.service';
import type { PlaybookExecutionAdminSettings } from '@modules/system/interfaces/playbook-settings.interface';
import type { FlowDesignSettings } from '../interfaces/playbook-flow-settings.interface';
import {
  PlaybookFlowSettingsService,
  type ResolvedPlaybookPlannerAgentConfig,
} from './playbook-flow-settings.service';

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
    @Optional() private readonly settingsService?: PlaybookFlowSettingsService,
  ) {}

  async resolvePlanner(
    agentId: string,
    flowSettings?: Partial<FlowDesignSettings> | Record<string, unknown> | null,
  ): Promise<ResolvedPlaybookPlannerAgentConfig> {
    if (!this.settingsService) {
      throw new Error('PlaybookFlowSettingsService is required for planner model resolution');
    }
    return this.settingsService.resolvePlaybookPlanner(agentId, flowSettings);
  }

  async resolve(flowSettings?: { recursionLimit?: number; maxParallelism?: number }): Promise<EffectivePlaybookExecutionSettings> {
    const stored = (await this.systemService.getPlaybookSettings()).playbookExecution;
    const availableCapacity = Math.min(stored.availableCapacity, this.config.maxConcurrentGlobalExecutions);
    const maxParallelismPerExecution = stored.maxParallelismPerExecution;
    const effectiveExecutionParallelism = Math.min(
      Math.max(1, flowSettings?.maxParallelism ?? maxParallelismPerExecution),
      maxParallelismPerExecution,
    );
    const recursionLimitMax = stored.recursionLimitMax;

    return {
      ...stored,
      availableCapacity,
      maxConcurrentPerUser: Math.min(stored.maxConcurrentPerUser, availableCapacity),
      maxConcurrentPerFlow: Math.min(stored.maxConcurrentPerFlow, this.config.maxConcurrentPerFlow, availableCapacity),
      maxConcurrentPerProvider: Math.min(stored.maxConcurrentPerProvider, this.config.maxConcurrentPerProvider, availableCapacity),
      maxConcurrentPerModel: Math.min(stored.maxConcurrentPerModel, this.config.maxConcurrentPerModel, availableCapacity),
      executionQueueMaxDepth: stored.executionQueueMaxDepth,
      maxParallelismPerExecution,
      effectiveExecutionParallelism,
      recursionLimitDefault: Math.min(stored.recursionLimitDefault, recursionLimitMax),
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
