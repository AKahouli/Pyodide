import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentService } from '../agent/agent.service';
import type {
  CopilotAssistantAgentOption,
  CopilotAssistantSettings,
  CopilotAssistantSettingsValue,
} from './interfaces/copilot-assistant-settings.interface';
import { DEFAULT_COPILOT_ASSISTANT_SETTINGS } from './interfaces/copilot-assistant-settings.interface';
import { SystemSetting, SystemSettingDocument } from './schemas/system-setting.schema';

const KEY = 'copilot_assistant_settings';
const CACHE_MS = 5_000;

@Injectable()
export class CopilotAssistantSettingsService {
  private cache: { settings: CopilotAssistantSettings; expiresAt: number } | null = null;

  constructor(
    @InjectModel(SystemSetting.name) private readonly settings: Model<SystemSettingDocument>,
    private readonly agents: AgentService,
  ) {}

  async getSettings(): Promise<CopilotAssistantSettings> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.settings;

    const setting = await this.settings.findOne({ key: KEY }).lean().exec();
    const stored = setting?.value as Partial<CopilotAssistantSettingsValue> | undefined;
    const settings: CopilotAssistantSettings = {
      agentId: typeof stored?.agentId === 'string' && stored.agentId.trim()
        ? stored.agentId.trim()
        : DEFAULT_COPILOT_ASSISTANT_SETTINGS.agentId,
      updatedAt: setting?.updatedAt as Date | undefined,
    };
    this.cache = { settings, expiresAt: Date.now() + CACHE_MS };
    return settings;
  }

  listActiveAgentOptions(): Promise<CopilotAssistantAgentOption[]> {
    return this.agents.listActivePlatformCopilotAgentOptions();
  }

  async updateSettings(value: { agentId?: string | null }): Promise<CopilotAssistantSettings> {
    if (value.agentId) {
      await this.agents.assertActivePlatformCopilotAgent(value.agentId);
    }
    const persisted: CopilotAssistantSettingsValue = {
      agentId: value.agentId?.trim() || null,
    };
    const updated = await this.settings.findOneAndUpdate(
      { key: KEY },
      { key: KEY, value: persisted },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec();
    const result: CopilotAssistantSettings = {
      ...persisted,
      updatedAt: updated?.updatedAt as Date | undefined,
    };
    this.cache = { settings: result, expiresAt: Date.now() + CACHE_MS };
    return result;
  }
}
