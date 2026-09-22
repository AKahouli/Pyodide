import { Inject, Injectable } from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { SYSTEM_SETTING_STORE, type SystemSettingStore } from './persistence/system-setting.store';
import type { WorkspaceTransformationAgentOption, WorkspaceTransformationSettings, WorkspaceTransformationSettingsValue } from './interfaces/workspace-transformation-settings.interface';

const KEY = 'workspace_transformations';

@Injectable()
export class WorkspaceTransformationSettingsService {
  constructor(@Inject(SYSTEM_SETTING_STORE) private readonly settings: SystemSettingStore, private readonly agents: AgentService) {}

  async getSettings(): Promise<WorkspaceTransformationSettings> {
    const setting = await this.settings.get(KEY);
    const value = setting?.value as Partial<WorkspaceTransformationSettingsValue> | undefined;
    return { decisionFlowAgentId: typeof value?.decisionFlowAgentId === 'string' ? value.decisionFlowAgentId : null, updatedAt: setting?.updatedAt };
  }

  async listActiveAgentOptions(): Promise<WorkspaceTransformationAgentOption[]> {
    return this.agents.listActiveDefaultAgentOptions();
  }

  async updateSettings(decisionFlowAgentId: string | null): Promise<WorkspaceTransformationSettings> {
    if (decisionFlowAgentId) await this.agents.assertActiveDefaultAgent(decisionFlowAgentId);
    const updated = await this.settings.upsert(KEY, { decisionFlowAgentId });
    return { decisionFlowAgentId, updatedAt: updated.updatedAt };
  }
}
