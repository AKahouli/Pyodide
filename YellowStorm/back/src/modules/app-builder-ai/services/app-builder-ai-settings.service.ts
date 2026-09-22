import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SYSTEM_SETTING_STORE, type SystemSettingStore } from '../../system/persistence/system-setting.store';
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
    @Inject(SYSTEM_SETTING_STORE) private readonly settings: SystemSettingStore,
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
    await this.settings.upsert(APP_BUILDER_AI_SETTINGS_KEY, persisted);
    this.cache = { value: persisted, expiresAt: Date.now() + CACHE_MS };
    return persisted;
  }

  private async refresh(): Promise<AppBuilderAiSettings> {
    const setting = await this.settings.get(APP_BUILDER_AI_SETTINGS_KEY);
    const value = normalize(setting?.value);
    this.cache = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
  }
}
