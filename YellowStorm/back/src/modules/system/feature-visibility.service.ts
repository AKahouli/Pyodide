import { Injectable } from '@nestjs/common';
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
  const stored = value && typeof value === 'object'
    ? value as Partial<Record<keyof FeatureVisibility, unknown>>
    : {};

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
export class FeatureVisibilityService {
  private cache: { value: FeatureVisibility; expiresAt: number } | null = null;

  constructor(
    @InjectModel(SystemSetting.name)
    private readonly settings: Model<SystemSettingDocument>,
  ) {}

  async getVisibility(): Promise<FeatureVisibility> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }

    const setting = await this.settings.findOne({ key: KEY }).lean().exec();
    const value = normalizeFeatureVisibility(setting?.value);
    this.cache = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
  }

  async updateVisibility(value: FeatureVisibility): Promise<FeatureVisibility> {
    const persisted = { ...value };
    await this.settings.findOneAndUpdate(
      { key: KEY },
      { key: KEY, value: persisted },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec();

    this.cache = { value: persisted, expiresAt: Date.now() + CACHE_MS };
    return persisted;
  }
}
