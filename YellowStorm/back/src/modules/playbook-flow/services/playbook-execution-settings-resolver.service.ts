import { Injectable, Optional } from '@nestjs/common';
import { SystemService } from '@modules/system/system.service';
import type { PlaybookExecutionAdminSettings } from '@modules/system/interfaces/playbook-settings.interface';
import type { FlowDesignSettings } from '../interfaces/playbook-flow-settings.interface';
import {
  PlaybookFlowSettingsService,
  type ResolvedPlaybookPlannerAgentConfig,
} from './playbook-flow-settings.service';

export interface EffectivePlaybookExecutionSettings extends PlaybookExecutionAdminSettings {
  effectiveExecutionParallelism: number;
}

@Injectable()
export class PlaybookExecutionSettingsResolverService {
  constructor(
    private readonly systemService: SystemService,
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
    // Admin-managed settings (catalog.system_settings `playbook_settings`) are
    // authoritative; normalization already bounds every value.
    const stored = (await this.systemService.getPlaybookSettings()).playbookExecution;
    const maxParallelismPerExecution = stored.maxParallelismPerExecution;
    const effectiveExecutionParallelism = Math.min(
      Math.max(1, flowSettings?.maxParallelism ?? maxParallelismPerExecution),
      maxParallelismPerExecution,
    );
    const recursionLimitMax = stored.recursionLimitMax;

    return {
      ...stored,
      maxParallelismPerExecution,
      effectiveExecutionParallelism,
      recursionLimitDefault: Math.min(stored.recursionLimitDefault, recursionLimitMax),
      recursionLimitMax,
      dynamicReasoning: {
        ...stored.dynamicReasoning,
        maxParallelism: Math.min(stored.dynamicReasoning.maxParallelism, effectiveExecutionParallelism),
        maxDepth: 1,
      },
    };
  }
}
