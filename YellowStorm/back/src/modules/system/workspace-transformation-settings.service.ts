import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentService } from '../agent/agent.service';
import { SystemSetting, SystemSettingDocument } from './schemas/system-setting.schema';
import type { WorkspaceTransformationAgentOption, WorkspaceTransformationSettings, WorkspaceTransformationSettingsValue } from './interfaces/workspace-transformation-settings.interface';

const KEY = 'workspace_transformations';

@Injectable()
export class WorkspaceTransformationSettingsService {
  constructor(@InjectModel(SystemSetting.name) private readonly settings: Model<SystemSettingDocument>, private readonly agents: AgentService) {}

  async getSettings(): Promise<WorkspaceTransformationSettings> {
    const setting = await this.settings.findOne({ key: KEY }).lean().exec();
    const value = setting?.value as Partial<WorkspaceTransformationSettingsValue> | undefined;
    return { decisionFlowAgentId: typeof value?.decisionFlowAgentId === 'string' ? value.decisionFlowAgentId : null, updatedAt: setting?.updatedAt as Date | undefined };
  }

  async listActiveAgentOptions(): Promise<WorkspaceTransformationAgentOption[]> {
    return this.agents.listActiveDefaultAgentOptions();
  }

  async updateSettings(decisionFlowAgentId: string | null): Promise<WorkspaceTransformationSettings> {
    if (decisionFlowAgentId) await this.agents.assertActiveDefaultAgent(decisionFlowAgentId);
    const updated = await this.settings.findOneAndUpdate({ key: KEY }, { key: KEY, value: { decisionFlowAgentId } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean().exec();
    return { decisionFlowAgentId, updatedAt: updated?.updatedAt as Date | undefined };
  }
}
