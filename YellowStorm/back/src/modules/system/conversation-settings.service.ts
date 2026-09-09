import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentService } from '../agent/agent.service';
import type {
  CompactionSettings,
  ComposerSuggestionSettings,
  ConversationNameSettings,
  ConversationSettings,
  ConversationSettingsAgentOption,
  ConversationSettingsValue,
} from './interfaces/conversation-settings.interface';
import { DEFAULT_CONVERSATION_SETTINGS } from './interfaces/conversation-settings.interface';
import { SystemSetting, SystemSettingDocument } from './schemas/system-setting.schema';

const KEY = 'conversation_settings';
const CACHE_MS = 5_000;
const MAX_STALE_MS = 1_000;

@Injectable()
export class ConversationSettingsService implements OnModuleInit {
  private cache: { settings: ConversationSettings; expiresAt: number } | null = null;
  private pending: Promise<ConversationSettings> | null = null;
  private cacheVersion = 0;

  constructor(
    @InjectModel(SystemSetting.name) private readonly settings: Model<SystemSettingDocument>,
    private readonly agents: AgentService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.getSettings();
  }

  async getSettings(): Promise<ConversationSettings> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.settings;

    if (!this.pending) this.pending = this.loadSettings(this.cacheVersion);
    const pending = this.pending;
    try {
      return await pending;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  private async loadSettings(version: number): Promise<ConversationSettings> {
    const setting = await this.settings.findOne({ key: KEY }).lean().exec();
    const stored = setting?.value as Partial<ConversationSettingsValue> | undefined;
    const settings: ConversationSettings = {
      redactSensitiveText: stored?.redactSensitiveText !== false,
      latencyInstrumentationEnabled: stored?.latencyInstrumentationEnabled !== false,
      composerSuggestions: {
        ...DEFAULT_CONVERSATION_SETTINGS.composerSuggestions,
        ...(stored?.composerSuggestions ?? {}),
      },
      conversationName: {
        ...DEFAULT_CONVERSATION_SETTINGS.conversationName,
        ...(stored?.conversationName ?? {}),
      },
      compaction: {
        ...DEFAULT_CONVERSATION_SETTINGS.compaction,
        ...(stored?.compaction ?? {}),
      },
      updatedAt: setting?.updatedAt as Date | undefined,
    };
    if (version === this.cacheVersion) {
      this.cache = { settings, expiresAt: Date.now() + CACHE_MS };
      return settings;
    }
    return this.cache?.settings ?? settings;
  }

  listActiveAgentOptions(): Promise<ConversationSettingsAgentOption[]> {
    return this.agents.listActiveDefaultAgentOptions();
  }

  shouldRedactSensitiveText(): boolean {
    if (this.cache) {
      const now = Date.now();
      if (this.cache.expiresAt <= now) {
        const version = this.cacheVersion;
        void this.getSettings().catch(() => {
          if (version === this.cacheVersion) this.cache = null;
        });
      }
      return this.cache.settings.redactSensitiveText !== false
        || now > this.cache.expiresAt + MAX_STALE_MS;
    }
    void this.getSettings().catch(() => undefined);
    return true;
  }

  /** Whether classic Conversation turns carry the end-to-end latency trace context. */
  async isLatencyInstrumentationEnabled(): Promise<boolean> {
    return (await this.getSettings()).latencyInstrumentationEnabled !== false;
  }

  /**
   * Synchronous cached read for request-entry paths that must not block on
   * settings DB I/O (latency instrumentation sampling). Serves the in-memory
   * value, triggers an async refresh when stale, and falls back to the default
   * (enabled) once the cache is too stale to trust.
   */
  isLatencyInstrumentationEnabledCached(): boolean {
    if (this.cache) {
      const now = Date.now();
      if (this.cache.expiresAt <= now) {
        const version = this.cacheVersion;
        void this.getSettings().catch(() => {
          if (version === this.cacheVersion) this.cache = null;
        });
      }
      return this.cache.settings.latencyInstrumentationEnabled !== false
        || now > this.cache.expiresAt + MAX_STALE_MS;
    }
    void this.getSettings().catch(() => undefined);
    return true;
  }

  async updateSettings(
    value: { composerSuggestions: ComposerSuggestionSettings } & {
      conversationName?: ConversationNameSettings;
      redactSensitiveText?: boolean;
      latencyInstrumentationEnabled?: boolean;
      compaction?: CompactionSettings;
    },
  ): Promise<ConversationSettings> {
    if (value.composerSuggestions.agentId) {
      await this.agents.assertActiveDefaultAgent(value.composerSuggestions.agentId);
    }
    // Cache-first so an admin update never blocks on a stalled settings refresh.
    const current = this.cache?.settings ?? await this.getSettings();
    const persisted: ConversationSettingsValue = {
      redactSensitiveText: value.redactSensitiveText ?? current.redactSensitiveText,
      latencyInstrumentationEnabled:
        value.latencyInstrumentationEnabled ?? current.latencyInstrumentationEnabled,
      composerSuggestions: { ...value.composerSuggestions },
      conversationName: { ...(value.conversationName ?? current.conversationName) },
      compaction: { ...(value.compaction ?? current.compaction) },
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
    this.cacheVersion += 1;
    this.cache = { settings: result, expiresAt: Date.now() + CACHE_MS };
    return result;
  }

  async updateSensitiveTextRedaction(redactSensitiveText: boolean): Promise<ConversationSettings> {
    const current = this.cache?.settings ?? await this.getSettings();
    return this.updateSettings({
      composerSuggestions: current.composerSuggestions,
      redactSensitiveText,
    });
  }
}
