import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { LoggerService } from '../logger';
import { SYSTEM_SETTING_STORE, type SystemSettingStore } from './persistence/system-setting.store';
import {
  PLATFORM_SETTINGS_KEY,
  normalizePlatformSettings,
  type PartialPlatformSettings,
  type PlatformSettingsValue,
} from './constants/platform-settings.constants';

export interface PlatformSettings extends PlatformSettingsValue {
  updatedAt?: Date;
}

@Injectable()
export class PlatformSettingsService implements OnApplicationBootstrap {
  private cache: PlatformSettingsValue | null = null;
  private cacheLoadedAt = 0;
  private static readonly CACHE_TTL_MS = 5_000;

  constructor(
    @Inject(SYSTEM_SETTING_STORE)
    private readonly systemSettings: SystemSettingStore,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlatformSettingsService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureDefaultSettings();
    } catch (error) {
      this.logger.warn('Failed to seed platform settings', {
        error: (error as Error).message,
      });
      this.cache = normalizePlatformSettings(null);
    }
  }

  /**
   * Returns the current platform settings, cached briefly so hot paths
   * (rate limiting, upload validation) do not hit the DB per request.
   */
  async getSettings(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cacheLoadedAt < PlatformSettingsService.CACHE_TTL_MS) {
      return this.cache;
    }

    const setting = await this.systemSettings.get(PLATFORM_SETTINGS_KEY);
    this.cache = normalizePlatformSettings(setting?.value as PartialPlatformSettings | null | undefined);
    this.cacheLoadedAt = Date.now();
    return this.cache;
  }

  async updateSettings(raw: PartialPlatformSettings, actorId?: string): Promise<PlatformSettings> {
    const current = await this.getSettings();
    const merged = normalizePlatformSettings({
      throttle: { ...current.throttle, ...raw.throttle },
      auth: { ...current.auth, ...raw.auth },
      documentUpload: { ...current.documentUpload, ...raw.documentUpload },
    });

    const updated = await this.systemSettings.upsert(PLATFORM_SETTINGS_KEY, merged);
    this.cache = merged;
    this.cacheLoadedAt = Date.now();

    this.logger.log('Platform settings updated', { actorId });

    return { ...merged, updatedAt: updated.updatedAt };
  }

  async ensureDefaultSettings(): Promise<void> {
    const existing = await this.systemSettings.get(PLATFORM_SETTINGS_KEY);
    if (existing) return;

    const value = normalizePlatformSettings(null);
    await this.systemSettings.upsert(PLATFORM_SETTINGS_KEY, value);
    this.cache = value;
    this.cacheLoadedAt = Date.now();
    this.logger.log('Seeded default platform settings');
  }
}
