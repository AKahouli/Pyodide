import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentService } from '../agent/agent.service';
import type {
  ConversationSettings,
  ConversationSettingsAgentOption,
  ConversationSettingsValue,
} from './interfaces/conversation-settings.interface';
import { DEFAULT_CONVERSATION_SETTINGS } from './interfaces/conversation-settings.interface';
import { SystemSetting, SystemSettingDocument } from './schemas/system-setting.schema';

const KEY = 'conversation_settings';
const CACHE_MS = 5_000;

@Injectable()
export class ConversationSettingsService {
  private cache: { settings: ConversationSettings; expiresAt: number } | null = null;

  constructor(
    @InjectModel(SystemSetting.name) private readonly settings: Model<SystemSettingDocument>,
    private readonly agents: AgentService,
  ) {}

  async getSettings(): Promise<ConversationSettings> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.settings;

    const setting = await this.settings.findOne({ key: KEY }).lean().exec();
    const stored = setting?.value as Partial<ConversationSettingsValue> | undefined;
    const settings: ConversationSettings = {
      composerSuggestions: {
        ...DEFAULT_CONVERSATION_SETTINGS.composerSuggestions,
        ...(stored?.composerSuggestions ?? {}),
      },
      updatedAt: setting?.updatedAt as Date | undefined,
    };
    this.cache = { settings, expiresAt: Date.now() + CACHE_MS };
    return settings;
  }

  listActiveAgentOptions(): Promise<ConversationSettingsAgentOption[]> {
    return this.agents.listActiveDefaultAgentOptions();
  }

  async updateSettings(value: ConversationSettingsValue): Promise<ConversationSettings> {
    if (value.composerSuggestions.agentId) {
      await this.agents.assertActiveDefaultAgent(value.composerSuggestions.agentId);
    }
    const persisted: ConversationSettingsValue = {
      composerSuggestions: { ...value.composerSuggestions },
    };
    const updated = await this.settings.findOneAndUpdate(
      { key: KEY },
      { key: KEY, value: persisted },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec();
    const result: ConversationSettings = {
      ...persisted,
      updatedAt: updated?.updatedAt as Date | undefined,
    };
    this.cache = { settings: result, expiresAt: Date.now() + CACHE_MS };
    return result;
  }
}
