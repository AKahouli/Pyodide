import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DEFAULT_FEATURE_VISIBILITY,
  FeatureVisibility,
} from './interfaces/feature-visibility.interface';
import { SystemSetting, SystemSettingDocument } from './schemas/system-setting.schema';

const KEY = 'feature_visibility';
const CACHE_MS = 5_000;

function normalizeFeatureVisibility(value: unknown): FeatureVisibility {
  const raw = value && typeof value === 'object'
    ? value as Partial<Record<string, unknown>>
    : {};

  const stored = { ...raw };
  if (typeof stored.appMarketplace === 'boolean' && typeof stored.appBuilder !== 'boolean') {
    stored.appBuilder = stored.appMarketplace;
  }

  return Object.fromEntries(
    Object.entries(DEFAULT_FEATURE_VISIBILITY).map(([key, fallback]) => [
      key,
      typeof stored[key as keyof FeatureVisibility] === 'boolean'
        ? stored[key as keyof FeatureVisibility]
        : fallback,
    ]),
  ) as unknown as FeatureVisibility;
}

@Injectable()
export class FeatureVisibilityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeatureVisibilityService.name);
  private cache: { value: FeatureVisibility; expiresAt: number } | null = null;
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    @InjectModel(SystemSetting.name)
    private readonly settings: Model<SystemSettingDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.getVisibility();
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch((error) => this.logger.warn(
        `Failed to refresh feature visibility: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ));
    }, CACHE_MS);
    this.refreshTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  isEnabled(key: keyof FeatureVisibility): boolean {
    return (this.cache?.value ?? DEFAULT_FEATURE_VISIBILITY)[key];
  }

  async getVisibility(): Promise<FeatureVisibility> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }

    return this.refresh();
  }

  async updateVisibility(value: Partial<FeatureVisibility>): Promise<FeatureVisibility> {
    const persisted = normalizeFeatureVisibility({ ...await this.getVisibility(), ...value });
    await this.settings.findOneAndUpdate(
      { key: KEY },
      { key: KEY, value: persisted },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec();

    this.cache = { value: persisted, expiresAt: Date.now() + CACHE_MS };
    return persisted;
  }

  private async refresh(): Promise<FeatureVisibility> {
    const setting = await this.settings.findOne({ key: KEY }).lean().exec();
    const value = normalizeFeatureVisibility(setting?.value);
    this.cache = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
  }
}
