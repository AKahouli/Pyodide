import { Injectable, OnApplicationBootstrap, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SystemSetting,
  SystemSettingDocument,
} from './schemas/system-setting.schema';
import { LoggerService } from '../logger';
import { EXTENSION_MIME_TYPES } from '../document/constants/mime-types.constant';
import {
  DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS,
  WORKSPACE_UPLOAD_SETTINGS_KEY,
  getUploadExtension,
  isValidUploadExtension,
  normalizeUploadExtension,
} from './constants/workspace-upload-settings.constants';
import {
  WorkspaceUploadSettings,
  WorkspaceUploadSettingsValue,
} from './interfaces/workspace-upload-settings.interface';

const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXTENSION_MIME_TYPES));
const SUPPORTED_EXTENSIONS_LIST = Object.keys(EXTENSION_MIME_TYPES).sort();

@Injectable()
export class WorkspaceUploadSettingsService implements OnApplicationBootstrap {
  private cache: WorkspaceUploadSettingsValue | null = null;
  private cacheLoadedAt = 0;
  private static readonly CACHE_TTL_MS = 5_000;

  constructor(
    @InjectModel(SystemSetting.name)
    private readonly systemSettingModel: Model<SystemSettingDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkspaceUploadSettingsService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureDefaultSettings();
    } catch (error) {
      this.logger.warn('Failed to seed workspace upload settings', {
        error: (error as Error).message,
      });
      this.cache = { allowedExtensions: [...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS] };
    }
  }

  /**
   * Returns the current upload settings. Cached briefly to avoid
   * hitting the DB on every upload validation call.
   */
  async getSettings(): Promise<WorkspaceUploadSettings> {
    if (this.cache && Date.now() - this.cacheLoadedAt < WorkspaceUploadSettingsService.CACHE_TTL_MS) {
      return this.buildSettingsResponse(this.cache);
    }

    const setting = await this.systemSettingModel.findOne({ key: WORKSPACE_UPLOAD_SETTINGS_KEY }).lean().exec();
    if (setting && this.isUploadSettingsValue(setting.value)) {
      this.cache = { allowedExtensions: [...setting.value.allowedExtensions] };
      this.cacheLoadedAt = Date.now();
      return this.buildSettingsResponse(this.cache, setting.updatedAt as Date | undefined);
    }

    if (setting) {
      this.logger.warn('Stored workspace upload settings are malformed; reverting to defaults', {
        key: WORKSPACE_UPLOAD_SETTINGS_KEY,
      });
    }

    this.cache = { allowedExtensions: [...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS] };
    this.cacheLoadedAt = Date.now();
    return this.buildSettingsResponse(this.cache);
  }

  getSupportedExtensions(): string[] {
    return [...SUPPORTED_EXTENSIONS_LIST];
  }

  async getAllowedExtensions(): Promise<string[]> {
    const settings = await this.getSettings();
    return settings.allowedExtensions;
  }

  async isExtensionAllowed(filename: string): Promise<boolean> {
    const extension = getUploadExtension(filename);
    if (!extension) return false;
    const allowed = await this.getAllowedExtensions();
    return allowed.includes(extension);
  }

  /**
   * Returns the MIME types accepted for a given extension according to the
   * static backend map. Returns an empty array when the extension is
   * unknown — callers treat that as "no upload possible".
   */
  getAllowedMimeTypesForExtension(extension: string): string[] {
    const normalized = extension.toLowerCase();
    if (!isValidUploadExtension(normalized)) return [];
    const mime = EXTENSION_MIME_TYPES[normalized];
    return mime ? [mime] : [];
  }

  async updateSettings(rawExtensions: string[], actorId?: string): Promise<WorkspaceUploadSettings> {
    const { normalized, rejected } = this.normalizeAndValidate(rawExtensions);
    if (rejected.length > 0) {
      this.logger.warn('Rejected upload extension entries', {
        actorId,
        rejected,
      });
    }
    if (normalized.length === 0) {
      throw new BadRequestException('At least one valid extension is required');
    }

    const value: WorkspaceUploadSettingsValue = { allowedExtensions: normalized };
    const updated = await this.systemSettingModel
      .findOneAndUpdate(
        { key: WORKSPACE_UPLOAD_SETTINGS_KEY },
        { key: WORKSPACE_UPLOAD_SETTINGS_KEY, value },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    this.cache = { allowedExtensions: [...normalized] };
    this.cacheLoadedAt = Date.now();

    this.logger.log('Workspace upload settings updated', {
      actorId,
      count: normalized.length,
    });

    return {
      ...this.buildSettingsResponse(this.cache),
      updatedAt: updated?.updatedAt as Date | undefined,
    };
  }

  async ensureDefaultSettings(): Promise<void> {
    const existing = await this.systemSettingModel
      .findOne({ key: WORKSPACE_UPLOAD_SETTINGS_KEY })
      .lean()
      .exec();
    if (existing) return;

    await this.systemSettingModel.create({
      key: WORKSPACE_UPLOAD_SETTINGS_KEY,
      value: { allowedExtensions: [...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS] },
    });
    this.cache = { allowedExtensions: [...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS] };
    this.cacheLoadedAt = Date.now();
    this.logger.log('Seeded default workspace upload settings', {
      count: DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS.length,
    });
  }

  private normalizeAndValidate(raw: string[]): { normalized: string[]; rejected: string[] } {
    const seen = new Set<string>();
    const normalized: string[] = [];
    const rejected: string[] = [];

    for (const entry of raw) {
      const next = normalizeUploadExtension(entry);
      if (!next) {
        rejected.push(entry);
        continue;
      }
      if (!SUPPORTED_EXTENSIONS.has(next)) {
        rejected.push(entry);
        continue;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      normalized.push(next);
    }

    return { normalized, rejected };
  }

  private isUploadSettingsValue(value: unknown): value is WorkspaceUploadSettingsValue {
    return (
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as WorkspaceUploadSettingsValue).allowedExtensions) &&
      (value as WorkspaceUploadSettingsValue).allowedExtensions.every((item) => typeof item === 'string')
    );
  }

  private buildSettingsResponse(
    value: WorkspaceUploadSettingsValue,
    updatedAt?: Date,
  ): WorkspaceUploadSettings {
    return {
      allowedExtensions: [...value.allowedExtensions],
      supportedExtensions: this.getSupportedExtensions(),
      updatedAt,
    };
  }
}
