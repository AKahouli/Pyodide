import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SystemSetting, SystemSettingDocument } from '../../system/schemas/system-setting.schema';
import {
  APP_BUILDER_AI_SETTINGS_KEY,
  DEFAULT_APP_BUILDER_AI_SETTINGS,
  type AppBuilderAiSettings,
} from '../constants';

const CACHE_MS = 5_000;

function normalize(value: unknown): AppBuilderAiSettings {
  const raw =
    value && typeof value === 'object'
      ? (value as Partial<AppBuilderAiSettings>)
      : {};
  return {
    enabled:
      typeof raw.enabled === 'boolean'
        ? raw.enabled
        : DEFAULT_APP_BUILDER_AI_SETTINGS.enabled,
  };
}

@Injectable()
export class AppBuilderAiSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppBuilderAiSettingsService.name);
  private cache: { value: AppBuilderAiSettings; expiresAt: number } | null = null;
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    @InjectModel(SystemSetting.name)
    private readonly settings: Model<SystemSettingDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.getSettings();
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch((error) =>
        this.logger.warn(
          `Failed to refresh App Builder AI settings: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        ),
      );
    }, CACHE_MS);
    this.refreshTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  isEnabled(): boolean {
    return (this.cache?.value ?? DEFAULT_APP_BUILDER_AI_SETTINGS).enabled;
  }

  async getSettings(): Promise<AppBuilderAiSettings> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }
    return this.refresh();
  }

  async setEnabled(enabled: boolean): Promise<AppBuilderAiSettings> {
    const persisted = normalize({ ...(await this.getSettings()), enabled });
    await this.settings
      .findOneAndUpdate(
        { key: APP_BUILDER_AI_SETTINGS_KEY },
        { key: APP_BUILDER_AI_SETTINGS_KEY, value: persisted },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();
    this.cache = { value: persisted, expiresAt: Date.now() + CACHE_MS };
    return persisted;
  }

  private async refresh(): Promise<AppBuilderAiSettings> {
    const setting = await this.settings
      .findOne({ key: APP_BUILDER_AI_SETTINGS_KEY })
      .lean()
      .exec();
    const value = normalize(setting?.value);
    this.cache = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
  }
}
