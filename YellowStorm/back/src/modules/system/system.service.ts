import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SystemSetting, SystemSettingDocument, MaintenanceValue, RegistrationValue, AppearanceValue, CorsSettingsValue } from './schemas/system-setting.schema';
import { MaintenanceStatus } from './interfaces/maintenance.interface';
import { RegistrationStatus } from './interfaces/registration.interface';
import { AppearanceSettings } from './interfaces/appearance.interface';
import {
  AdminPlaybookSettings,
  DEFAULT_ADMIN_PLAYBOOK_SETTINGS,
  normalizePlaybookExecutionSettings,
  DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS,
  PlaybookIntentNormalizationLimits,
} from './interfaces/playbook-settings.interface';
import { LoggerService } from '../logger';
import { User, UserDocument } from '../user/schemas/user.schema';

const MAINTENANCE_KEY = 'maintenance_mode';
const REGISTRATION_KEY = 'registration_settings';
const APPEARANCE_KEY = 'appearance_settings';
const PLAYBOOK_SETTINGS_KEY = 'playbook_settings';
const CORS_SETTINGS_KEY = 'cors_settings';
const CACHE_TTL_MS = 5000; // 5 seconds
const DEFAULT_APPEARANCE: AppearanceSettings = {
  defaultColorTheme: 'default',
  themes: {
    default: { labelKey: 'appearance.colorTheme.default', logo: 'yellowmind' },
    yellow: { labelKey: 'appearance.colorTheme.yellow', logo: 'yellowmind' },
    orange: { labelKey: 'appearance.colorTheme.orange', logo: 'kpmg' },
    blue: { labelKey: 'appearance.colorTheme.blue', logo: 'kpmg' },
  },
};

function normalizeAppearanceSettings(value: AppearanceValue): AppearanceSettings {
  const normalizeLogo = (logo?: string): 'yellowmind' | 'kpmg' => (logo === 'kpmg' ? 'kpmg' : 'yellowmind');

  return {
    defaultColorTheme: value.defaultColorTheme as AppearanceSettings['defaultColorTheme'],
    themes: {
      default: {
        labelKey: value.themes.default?.labelKey ?? 'appearance.colorTheme.default',
        logo: normalizeLogo(value.themes.default?.logo),
      },
      yellow: {
        labelKey: value.themes.yellow?.labelKey ?? 'appearance.colorTheme.yellow',
        logo: normalizeLogo(value.themes.yellow?.logo),
      },
      orange: {
        labelKey: value.themes.orange?.labelKey ?? 'appearance.colorTheme.orange',
        logo: normalizeLogo(value.themes.orange?.logo),
      },
      blue: {
        labelKey: value.themes.blue?.labelKey ?? 'appearance.colorTheme.blue',
        logo: normalizeLogo(value.themes.blue?.logo),
      },
    },
  };
}

function normalizePlaybookIntentNormalizationLimits(
  value: Partial<PlaybookIntentNormalizationLimits> | Record<string, unknown> | null | undefined,
): PlaybookIntentNormalizationLimits {
  const normalizeLimit = (raw: unknown, fallback: number, min: number, max: number): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(raw)));
  };

  return {
    maxWorkflowPlanChanges: normalizeLimit(
      value?.maxWorkflowPlanChanges,
      DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS.maxWorkflowPlanChanges,
      1,
      DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS.maxWorkflowPlanChanges,
    ),
    maxInputPorts: normalizeLimit(
      value?.maxInputPorts,
      DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS.maxInputPorts,
      1,
      20,
    ),
    maxOutputPorts: normalizeLimit(
      value?.maxOutputPorts,
      DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS.maxOutputPorts,
      1,
      20,
    ),
    maxIteratorBodySteps: normalizeLimit(
      value?.maxIteratorBodySteps,
      DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS.maxIteratorBodySteps,
      1,
      50,
    ),
    maxIteratorBodyEdges: normalizeLimit(
      value?.maxIteratorBodyEdges,
      DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS.maxIteratorBodyEdges,
      1,
      100,
    ),
  };
}

@Injectable()
export class SystemService implements OnApplicationBootstrap {
  private maintenanceCache: MaintenanceStatus | null = null;
  private registrationCache: RegistrationStatus | null = null;
  private appearanceCache: AppearanceSettings | null = null;
  private playbookSettingsCache: AdminPlaybookSettings | null = null;
  private corsSettingsCache: CorsSettingsValue | null = null;
  private lastCacheUpdate = 0;
  private lastRegistrationCacheUpdate = 0;
  private lastPlaybookSettingsCacheUpdate = 0;
  private lastCorsCacheUpdate = 0;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectModel(SystemSetting.name)
    private readonly systemSettingModel: Model<SystemSettingDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SystemService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Initialize maintenance and registration status on startup
      await Promise.all([
        this.refreshMaintenanceCache(),
        this.refreshRegistrationCache(),
        this.refreshAppearanceCache(),
        this.refreshPlaybookSettingsCache(),
        this.refreshCorsSettingsCache(),
      ]);
      this.logger.log('System service initialized', {
        maintenanceEnabled: this.maintenanceCache?.enabled ?? false,
        registrationEnabled: this.registrationCache?.enabled ?? true,
        appearanceDefaultColorTheme: this.appearanceCache?.defaultColorTheme ?? 'default',
      });

      this.refreshInterval = setInterval(() => {
        this.refreshMaintenanceCache().catch((err) => {
          this.logger.warn('Periodic maintenance cache refresh failed', { error: err.message });
        });
        this.refreshRegistrationCache().catch((err) => {
          this.logger.warn('Periodic registration cache refresh failed', { error: err.message });
        });
        this.refreshAppearanceCache().catch((err) => {
          this.logger.warn('Periodic appearance cache refresh failed', { error: err.message });
        });
        this.refreshPlaybookSettingsCache().catch((err) => {
          this.logger.warn('Periodic playbook settings cache refresh failed', { error: err.message });
        });
        this.refreshCorsSettingsCache().catch((err) => {
          this.logger.warn('Periodic CORS settings cache refresh failed', { error: err.message });
        });
      }, CACHE_TTL_MS);
    } catch (error) {
      this.logger.warn('Failed to initialize system service', { error: (error as Error).message });
      // Initialize with safe defaults
      this.maintenanceCache = { enabled: false, message: '' };
      this.registrationCache = { enabled: true };
      this.appearanceCache = DEFAULT_APPEARANCE;
      this.playbookSettingsCache = DEFAULT_ADMIN_PLAYBOOK_SETTINGS;
    }
  }

  /**
   * Get maintenance status (cached for performance)
   */
  async getMaintenanceStatus(): Promise<MaintenanceStatus> {
    const now = Date.now();

    // Return cached value if still valid
    if (this.maintenanceCache && now - this.lastCacheUpdate < CACHE_TTL_MS) {
      return this.maintenanceCache;
    }

    // Refresh cache
    return this.refreshMaintenanceCache();
  }

  /**
   * Get maintenance status synchronously (from cache only)
   * Use this in guards for performance - returns last known state
   */
  getMaintenanceStatusSync(): MaintenanceStatus {
    return (
      this.maintenanceCache ?? {
        enabled: false,
        message: '',
      }
    );
  }

  /**
   * Check if maintenance is enabled (sync, from cache)
   */
  isMaintenanceEnabled(): boolean {
    return this.maintenanceCache?.enabled ?? false;
  }

  /**
   * Set maintenance mode
   */
  async setMaintenanceMode(
    enabled: boolean,
    options: {
      message?: string;
      estimatedEndAt?: Date;
      userId?: string;
    } = {},
  ): Promise<MaintenanceStatus> {
    const value: MaintenanceValue = {
      enabled,
      message: options.message ?? 'System is under maintenance. Please try again later.',
      startedAt: enabled ? new Date() : undefined,
      startedBy: enabled ? options.userId : undefined,
      estimatedEndAt: enabled ? options.estimatedEndAt : undefined,
    };

    await this.systemSettingModel.findOneAndUpdate(
      { key: MAINTENANCE_KEY },
      { key: MAINTENANCE_KEY, value },
      { upsert: true, new: true },
    );

    // Immediately update cache
    this.maintenanceCache = {
      enabled: value.enabled,
      message: value.message,
      startedAt: value.startedAt,
      startedBy: value.startedBy,
      estimatedEndAt: value.estimatedEndAt,
    };
    this.lastCacheUpdate = Date.now();

    this.logger.log(`Maintenance mode ${enabled ? 'enabled' : 'disabled'}`, {
      userId: options.userId,
      message: value.message,
      estimatedEndAt: value.estimatedEndAt,
    });

    return this.maintenanceCache;
  }

  /**
   * Refresh maintenance cache from database
   */
  private async refreshMaintenanceCache(): Promise<MaintenanceStatus> {
    try {
      const setting = await this.systemSettingModel.findOne({ key: MAINTENANCE_KEY });

      if (setting && this.isMaintenanceValue(setting.value)) {
        this.maintenanceCache = {
          enabled: setting.value.enabled,
          message: setting.value.message,
          startedAt: setting.value.startedAt,
          startedBy: setting.value.startedBy,
          estimatedEndAt: setting.value.estimatedEndAt,
        };
      } else {
        this.maintenanceCache = {
          enabled: false,
          message: '',
        };
      }

      this.lastCacheUpdate = Date.now();
      return this.maintenanceCache;
    } catch (error) {
      this.logger.error('Failed to refresh maintenance cache', {
        error: (error as Error).message,
      });

      // Return safe default if DB fails
      if (!this.maintenanceCache) {
        this.maintenanceCache = {
          enabled: false,
          message: '',
        };
      }

      return this.maintenanceCache;
    }
  }

  /**
   * Force refresh of maintenance cache (call after external changes)
   */
  async forceRefreshCache(): Promise<void> {
    await this.refreshMaintenanceCache();
    await this.refreshAppearanceCache();
    await this.refreshPlaybookSettingsCache();
    await this.refreshCorsSettingsCache();
  }

  // ─── CORS Settings ─────────────────────────────────────────────

  async getCorsSettings(): Promise<CorsSettingsValue> {
    const now = Date.now();
    if (this.corsSettingsCache && now - this.lastCorsCacheUpdate < CACHE_TTL_MS) {
      return this.corsSettingsCache;
    }
    return this.refreshCorsSettingsCache();
  }

  async setCorsSettings(origins: CorsSettingsValue['origins'], userId?: string): Promise<CorsSettingsValue> {
    const value: CorsSettingsValue = { origins };
    await this.systemSettingModel.findOneAndUpdate(
      { key: CORS_SETTINGS_KEY },
      { key: CORS_SETTINGS_KEY, value },
      { upsert: true, new: true },
    );
    this.corsSettingsCache = value;
    this.lastCorsCacheUpdate = Date.now();
    return value;
  }

  getEnabledCorsOrigins(): string[] {
    if (!this.corsSettingsCache?.origins) return [];
    return this.corsSettingsCache.origins
      .filter((entry) => entry.enabled)
      .map((entry) => entry.origin);
  }

  private async refreshCorsSettingsCache(): Promise<CorsSettingsValue> {
    try {
      const setting = await this.systemSettingModel.findOne({ key: CORS_SETTINGS_KEY }).lean().exec();
      const raw = setting?.value as Partial<CorsSettingsValue> | undefined;
      if (raw?.origins && Array.isArray(raw.origins)) {
        this.corsSettingsCache = {
          origins: raw.origins
            .filter((e) => typeof e.origin === 'string')
            .map((e) => ({ origin: e.origin, enabled: e.enabled !== false })),
        };
      } else {
        this.corsSettingsCache = { origins: [] };
      }
      this.lastCorsCacheUpdate = Date.now();
      return this.corsSettingsCache;
    } catch (error) {
      this.logger.error('Failed to refresh CORS settings cache', { error: (error as Error).message });
      this.corsSettingsCache = this.corsSettingsCache ?? { origins: [] };
      return this.corsSettingsCache;
    }
  }

  async getAppearanceSettings(): Promise<AppearanceSettings> {
    const now = Date.now();
    if (this.appearanceCache && now - this.lastCacheUpdate < CACHE_TTL_MS) {
      return this.appearanceCache;
    }

    return this.refreshAppearanceCache();
  }

  async setAppearanceSettings(settings: AppearanceSettings): Promise<AppearanceSettings> {
    const value: AppearanceValue = {
      defaultColorTheme: settings.defaultColorTheme,
      themes: settings.themes,
    };

    await this.systemSettingModel.findOneAndUpdate(
      { key: APPEARANCE_KEY },
      { key: APPEARANCE_KEY, value },
      { upsert: true, new: true },
    );

    this.appearanceCache = settings;
    this.lastCacheUpdate = Date.now();
    return settings;
  }

  async getPlaybookSettings(): Promise<AdminPlaybookSettings> {
    const now = Date.now();
    if (this.playbookSettingsCache && now - this.lastPlaybookSettingsCacheUpdate < CACHE_TTL_MS) {
      return this.playbookSettingsCache;
    }

    return this.refreshPlaybookSettingsCache();
  }

  async setPlaybookSettings(settings: AdminPlaybookSettings): Promise<AdminPlaybookSettings> {
    const value: AdminPlaybookSettings = {
      inferenceModelId: settings.inferenceModelId?.trim() || null,
      advisorEvaluationModelId: settings.advisorEvaluationModelId?.trim() || null,
      replayEvaluationModelId: settings.replayEvaluationModelId?.trim() || null,
      nodeSuggestionsMode: settings.nodeSuggestionsMode,
      approvalSuggestionMode: settings.approvalSuggestionMode,
      intentNormalizationLimits: normalizePlaybookIntentNormalizationLimits(settings.intentNormalizationLimits),
      useDeterministicBlueprintBuilder: typeof settings.useDeterministicBlueprintBuilder === 'boolean'
        ? settings.useDeterministicBlueprintBuilder
        : DEFAULT_ADMIN_PLAYBOOK_SETTINGS.useDeterministicBlueprintBuilder,
      playbookExecution: normalizePlaybookExecutionSettings(settings.playbookExecution),
    };

    await this.systemSettingModel.findOneAndUpdate(
      { key: PLAYBOOK_SETTINGS_KEY },
      { key: PLAYBOOK_SETTINGS_KEY, value },
      { upsert: true, new: true },
    );

    this.playbookSettingsCache = value;
    this.lastPlaybookSettingsCacheUpdate = Date.now();
    return value;
  }

  async applyAppearanceToAllUsers(colorTheme: AppearanceSettings['defaultColorTheme']): Promise<number> {
    const result = await this.userModel.updateMany({}, { $set: { 'appearance.colorTheme': colorTheme } });
    this.logger.log('Applied appearance theme to all users', {
      colorTheme,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
    return result.modifiedCount;
  }

  // ─── Registration ───────────────────────────────────────────────

  /**
   * Get registration status (cached for performance)
   */
  async getRegistrationStatus(): Promise<RegistrationStatus> {
    const now = Date.now();

    if (this.registrationCache && now - this.lastRegistrationCacheUpdate < CACHE_TTL_MS) {
      return this.registrationCache;
    }

    return this.refreshRegistrationCache();
  }

  /**
   * Get registration status synchronously (from cache only)
   */
  getRegistrationStatusSync(): RegistrationStatus {
    return this.registrationCache ?? { enabled: true };
  }

  /**
   * Check if registration is enabled (sync, from cache)
   */
  isRegistrationEnabled(): boolean {
    return this.registrationCache?.enabled ?? true;
  }

  /**
   * Check if classic (email/password) auth is enabled (sync, from cache)
   */
  isClassicAuthEnabled(): boolean {
    return this.registrationCache?.classicAuthEnabled ?? true;
  }

  /**
   * Set registration enabled/disabled
   */
  async setRegistrationEnabled(
    enabled: boolean,
    options: { userId?: string } = {},
  ): Promise<RegistrationStatus> {
    const value: RegistrationValue = {
      enabled,
      disabledAt: enabled ? undefined : new Date(),
      disabledBy: enabled ? undefined : options.userId,
      classicAuthEnabled: this.registrationCache?.classicAuthEnabled ?? true,
    };

    await this.systemSettingModel.findOneAndUpdate(
      { key: REGISTRATION_KEY },
      { key: REGISTRATION_KEY, value },
      { upsert: true, new: true },
    );

    // Immediately update cache
    this.registrationCache = {
      enabled: value.enabled,
      disabledAt: value.disabledAt,
      disabledBy: value.disabledBy,
      classicAuthEnabled: value.classicAuthEnabled,
    };
    this.lastRegistrationCacheUpdate = Date.now();

    this.logger.log(`Registration ${enabled ? 'enabled' : 'disabled'}`, {
      userId: options.userId,
    });

    return this.registrationCache;
  }

  /**
   * Set classic auth enabled/disabled
   */
  async setClassicAuthEnabled(
    enabled: boolean,
    options: { userId?: string } = {},
  ): Promise<RegistrationStatus> {
    const currentEnabled = this.registrationCache?.enabled ?? true;
    const currentDisabledAt = this.registrationCache?.disabledAt;
    const currentDisabledBy = this.registrationCache?.disabledBy;

    const value: RegistrationValue = {
      enabled: currentEnabled,
      disabledAt: currentDisabledAt,
      disabledBy: currentDisabledBy,
      classicAuthEnabled: enabled,
    };

    await this.systemSettingModel.findOneAndUpdate(
      { key: REGISTRATION_KEY },
      { key: REGISTRATION_KEY, value },
      { upsert: true, new: true },
    );

    this.registrationCache = {
      enabled: value.enabled,
      disabledAt: value.disabledAt,
      disabledBy: value.disabledBy,
      classicAuthEnabled: value.classicAuthEnabled,
    };
    this.lastRegistrationCacheUpdate = Date.now();

    this.logger.log(`Classic auth ${enabled ? 'enabled' : 'disabled'}`, {
      userId: options.userId,
    });

    return this.registrationCache;
  }

  /**
   * Refresh registration cache from database
   */
  private async refreshRegistrationCache(): Promise<RegistrationStatus> {
    try {
      const setting = await this.systemSettingModel.findOne({ key: REGISTRATION_KEY });

      if (setting && this.isRegistrationValue(setting.value)) {
        this.registrationCache = {
          enabled: setting.value.enabled,
          disabledAt: setting.value.disabledAt,
          disabledBy: setting.value.disabledBy,
          classicAuthEnabled: setting.value.classicAuthEnabled ?? true,
        };
      } else {
        this.registrationCache = { enabled: true, classicAuthEnabled: true };
      }

      this.lastRegistrationCacheUpdate = Date.now();
      return this.registrationCache;
    } catch (error) {
      this.logger.error('Failed to refresh registration cache', {
        error: (error as Error).message,
      });

      if (!this.registrationCache) {
        this.registrationCache = { enabled: true };
      }

      return this.registrationCache;
    }
  }

  private async refreshAppearanceCache(): Promise<AppearanceSettings> {
    try {
      const setting = await this.systemSettingModel.findOne({ key: APPEARANCE_KEY });

      if (setting && this.isAppearanceValue(setting.value)) {
        this.appearanceCache = normalizeAppearanceSettings(setting.value);
      } else {
        this.appearanceCache = DEFAULT_APPEARANCE;
      }

      this.lastCacheUpdate = Date.now();
      return this.appearanceCache;
    } catch (error) {
      this.logger.error('Failed to refresh appearance cache', {
        error: (error as Error).message,
      });

      this.appearanceCache = this.appearanceCache ?? DEFAULT_APPEARANCE;
      return this.appearanceCache;
    }
  }

  private async refreshPlaybookSettingsCache(): Promise<AdminPlaybookSettings> {
    try {
      const setting = await this.systemSettingModel.findOne({ key: PLAYBOOK_SETTINGS_KEY }).lean().exec();
      const value = setting?.value as Partial<AdminPlaybookSettings> | undefined;

      this.playbookSettingsCache = {
        inferenceModelId: typeof value?.inferenceModelId === 'string' && value.inferenceModelId.trim()
          ? value.inferenceModelId.trim()
          : null,
        advisorEvaluationModelId: typeof value?.advisorEvaluationModelId === 'string' && value.advisorEvaluationModelId.trim()
          ? value.advisorEvaluationModelId.trim()
          : null,
        replayEvaluationModelId: typeof value?.replayEvaluationModelId === 'string' && value.replayEvaluationModelId.trim()
          ? value.replayEvaluationModelId.trim()
          : null,
        nodeSuggestionsMode: value?.nodeSuggestionsMode === 'auto' ? 'auto' : DEFAULT_ADMIN_PLAYBOOK_SETTINGS.nodeSuggestionsMode,
        approvalSuggestionMode: value?.approvalSuggestionMode === 'manual' ? 'manual' : DEFAULT_ADMIN_PLAYBOOK_SETTINGS.approvalSuggestionMode,
        intentNormalizationLimits: normalizePlaybookIntentNormalizationLimits(value?.intentNormalizationLimits),
        useDeterministicBlueprintBuilder: typeof value?.useDeterministicBlueprintBuilder === 'boolean'
          ? value.useDeterministicBlueprintBuilder
          : DEFAULT_ADMIN_PLAYBOOK_SETTINGS.useDeterministicBlueprintBuilder,
        playbookExecution: normalizePlaybookExecutionSettings(value?.playbookExecution),
      };

      this.lastPlaybookSettingsCacheUpdate = Date.now();
      return this.playbookSettingsCache;
    } catch (error) {
      this.logger.error('Failed to refresh playbook settings cache', {
        error: (error as Error).message,
      });

      this.playbookSettingsCache = this.playbookSettingsCache ?? { ...DEFAULT_ADMIN_PLAYBOOK_SETTINGS };
      return this.playbookSettingsCache;
    }
  }

  /**
   * Type guard for RegistrationValue
   */
  private isRegistrationValue(value: unknown): value is RegistrationValue {
    return (
      typeof value === 'object' &&
      value !== null &&
      'enabled' in value &&
      typeof (value as RegistrationValue).enabled === 'boolean'
    );
  }

  private isAppearanceValue(value: unknown): value is AppearanceValue {
    return (
      typeof value === 'object' &&
      value !== null &&
      'defaultColorTheme' in value &&
      'themes' in value
    );
  }

  /**
   * Type guard for MaintenanceValue
   */
  private isMaintenanceValue(value: unknown): value is MaintenanceValue {
    return (
      typeof value === 'object' &&
      value !== null &&
      'enabled' in value &&
      typeof (value as MaintenanceValue).enabled === 'boolean'
    );
  }
}
