import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { MaintenanceValue, RegistrationValue, AppearanceValue, CorsSettingsValue, EmailLogoValue } from './schemas/system-setting.schema';
import { SYSTEM_SETTING_STORE, type SystemSettingStore } from './persistence/system-setting.store';
import { USER_STORE, type UserStore } from '../user/persistence/user.store';
import { MaintenanceStatus } from './interfaces/maintenance.interface';
import { RegistrationStatus } from './interfaces/registration.interface';
import { AppearanceSettings, AppearanceThemeSettings } from './interfaces/appearance.interface';
import {
  AdminPlaybookSettings,
  DEFAULT_ADMIN_PLAYBOOK_SETTINGS,
  normalizePlaybookExecutionSettings,
  DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS,
  PlaybookIntentNormalizationLimits,
} from './interfaces/playbook-settings.interface';
import { LoggerService } from '../logger';
import type { AuthUser } from '@common/auth/auth-user';
import { BadRequestException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { APPEARANCE_COLOR_THEMES, APPEARANCE_SETTINGS_KEY } from './constants/appearance-logo.constants';
import { AppearanceLogoService } from './services/appearance-logo.service';
import {
  DEFAULT_DOCUMENT_TREE_INJECTION_SETTINGS,
  DocumentTreeInjectionSettings,
} from './interfaces/document-tree-settings.interface';
import { DEFAULT_LOGIN_SETTINGS, LoginSettings, parseLoginExpiry } from './interfaces/login-settings.interface';

const MAINTENANCE_KEY = 'maintenance_mode';
const REGISTRATION_KEY = 'registration_settings';
const APPEARANCE_KEY = APPEARANCE_SETTINGS_KEY;
const PLAYBOOK_SETTINGS_KEY = 'playbook_settings';
const CORS_SETTINGS_KEY = 'cors_settings';
const DOCUMENT_TREE_INJECTION_KEY = 'document_tree_injection_settings';
const LOGIN_SETTINGS_KEY = 'login_settings';
export const EMAIL_LOGO_KEY = 'email_logo';
export const EMAIL_LOGO_MAX_BYTES = 512 * 1024;
const CACHE_TTL_MS = 5000; // 5 seconds
const DEFAULT_APPEARANCE: AppearanceThemeSettings = {
  defaultColorTheme: 'default',
  themes: {
    default: { labelKey: 'appearance.colorTheme.default', logo: 'yellowmind' },
    yellow: { labelKey: 'appearance.colorTheme.yellow', logo: 'yellowmind' },
    orange: { labelKey: 'appearance.colorTheme.orange', logo: 'kpmg' },
    blue: { labelKey: 'appearance.colorTheme.blue', logo: 'kpmg' },
  },
};

function normalizeAppearanceSettings(value: AppearanceValue): AppearanceThemeSettings {
  const normalizeLogo = (logo?: string): string => (typeof logo === 'string' && logo.trim() ? logo.trim() : 'yellowmind');

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
  private appearanceCache: AppearanceThemeSettings | null = null;
  private playbookSettingsCache: AdminPlaybookSettings | null = null;
  private corsSettingsCache: CorsSettingsValue | null = null;
  private loginSettingsCache: LoginSettings | null = null;
  private emailLogoCache: EmailLogoValue | null = null;
  private lastCacheUpdate = 0;
  private lastAppearanceCacheUpdate = 0;
  private lastRegistrationCacheUpdate = 0;
  private lastPlaybookSettingsCacheUpdate = 0;
  private lastCorsCacheUpdate = 0;
  private lastLoginSettingsCacheUpdate = 0;
  private lastEmailLogoCachedAt = 0;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(SYSTEM_SETTING_STORE)
    private readonly systemSettings: SystemSettingStore,
    @Inject(USER_STORE) private readonly userStore: UserStore,
    private readonly logger: LoggerService,
    private readonly appearanceLogoService: AppearanceLogoService,
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
        this.refreshLoginSettingsCache(),
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
        this.refreshLoginSettingsCache().catch((err) => {
          this.logger.warn('Periodic login settings cache refresh failed', { error: err.message });
        });
      }, CACHE_TTL_MS);
    } catch (error) {
      this.logger.warn('Failed to initialize system service', { error: (error as Error).message });
      // Initialize with safe defaults
      this.maintenanceCache = { enabled: false, message: '' };
      this.registrationCache = { enabled: true };
      this.appearanceCache = DEFAULT_APPEARANCE;
      this.playbookSettingsCache = DEFAULT_ADMIN_PLAYBOOK_SETTINGS;
      this.loginSettingsCache = DEFAULT_LOGIN_SETTINGS;
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

    await this.systemSettings.upsert(MAINTENANCE_KEY, value);

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
      const setting = await this.systemSettings.get(MAINTENANCE_KEY);

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
    await this.refreshLoginSettingsCache();
  }

  // ─── Login Settings ─────────────────────────────────────────────

  async getLoginSettings(): Promise<LoginSettings> {
    if (this.loginSettingsCache && Date.now() - this.lastLoginSettingsCacheUpdate < CACHE_TTL_MS) {
      return this.loginSettingsCache;
    }
    return this.refreshLoginSettingsCache();
  }

  getLoginSettingsSync(): LoginSettings {
    return this.loginSettingsCache ?? DEFAULT_LOGIN_SETTINGS;
  }

  async setLoginSettings(settings: LoginSettings): Promise<LoginSettings> {
    const accessMs = parseLoginExpiry(settings.accessExpiry);
    const refreshMs = parseLoginExpiry(settings.refreshExpiry);
    const minute = 60_000;
    const day = 24 * 60 * minute;

    if (!accessMs || accessMs < minute || accessMs > 30 * day) {
      throw new BadRequestException('Access token expiry must be between 1 minute and 30 days');
    }
    if (!refreshMs || refreshMs < 10 * minute || refreshMs > 365 * day) {
      throw new BadRequestException('Refresh token expiry must be between 10 minutes and 365 days');
    }
    if (refreshMs < accessMs) {
      throw new BadRequestException('Refresh token expiry must not be shorter than access token expiry');
    }

    const value = { accessExpiry: settings.accessExpiry, refreshExpiry: settings.refreshExpiry };
    await this.systemSettings.upsert(LOGIN_SETTINGS_KEY, value);
    this.loginSettingsCache = value;
    this.lastLoginSettingsCacheUpdate = Date.now();
    return value;
  }

  private async refreshLoginSettingsCache(): Promise<LoginSettings> {
    try {
      const setting = await this.systemSettings.get(LOGIN_SETTINGS_KEY);
      const value = setting?.value as Partial<LoginSettings> | undefined;
      const accessMs = typeof value?.accessExpiry === 'string' ? parseLoginExpiry(value.accessExpiry) : null;
      const refreshMs = typeof value?.refreshExpiry === 'string' ? parseLoginExpiry(value.refreshExpiry) : null;
      this.loginSettingsCache = accessMs && refreshMs && refreshMs >= accessMs
        ? { accessExpiry: value!.accessExpiry!, refreshExpiry: value!.refreshExpiry! }
        : DEFAULT_LOGIN_SETTINGS;
      this.lastLoginSettingsCacheUpdate = Date.now();
      return this.loginSettingsCache;
    } catch (error) {
      this.logger.error('Failed to refresh login settings cache', { error: (error as Error).message });
      this.loginSettingsCache = this.loginSettingsCache ?? DEFAULT_LOGIN_SETTINGS;
      return this.loginSettingsCache;
    }
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
    await this.systemSettings.upsert(CORS_SETTINGS_KEY, value);
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
      const setting = await this.systemSettings.get(CORS_SETTINGS_KEY);
      const raw = setting?.value as Partial<CorsSettingsValue> | undefined;
      if (raw?.origins && Array.isArray(raw.origins)) {
        this.corsSettingsCache = {
          origins: raw.origins
            .filter((e) => typeof e.origin === 'string')
            .map((e) => ({ origin: e.origin, enabled: e.enabled })),
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

  // ─── Email Logo ────────────────────────────────────────────────

  /**
   * Get the admin-configured email logo (cached). Returns null when the
   * default bundled logo should be used.
   */
  async getEmailLogo(): Promise<EmailLogoValue | null> {
    const now = Date.now();
    if (this.emailLogoCache !== null && now - this.lastEmailLogoCachedAt < CACHE_TTL_MS) {
      return this.emailLogoCache;
    }

    try {
      const setting = await this.systemSettings.get(EMAIL_LOGO_KEY);
      this.emailLogoCache = setting && this.isEmailLogoValue(setting.value) ? setting.value : null;
    } catch (error) {
      this.logger.error('Failed to load email logo setting', { error: (error as Error).message });
      this.emailLogoCache = this.emailLogoCache ?? null;
    }

    this.lastEmailLogoCachedAt = now;
    return this.emailLogoCache;
  }

  /**
   * Store a custom email logo (PNG/JPEG, up to EMAIL_LOGO_MAX_BYTES). The logo
   * is embedded in all email templates as an inline CID attachment.
   */
  async setEmailLogo(
    logo: { buffer: Buffer; contentType: string; filename: string; size: number },
    userId?: string,
  ): Promise<EmailLogoValue> {
    if (!this.isSupportedEmailLogoContentType(logo.contentType)) {
      throw new Error(`Unsupported email logo content type: ${logo.contentType}`);
    }
    if (logo.size <= 0 || logo.size > EMAIL_LOGO_MAX_BYTES) {
      throw new Error(`Email logo size must be between 1 and ${EMAIL_LOGO_MAX_BYTES} bytes`);
    }

    const value: EmailLogoValue = {
      data: logo.buffer.toString('base64'),
      contentType: logo.contentType,
      filename: logo.filename,
      size: logo.size,
      updatedAt: new Date(),
      updatedBy: userId,
    };

    await this.systemSettings.upsert(EMAIL_LOGO_KEY, value);

    this.emailLogoCache = value;
    this.lastEmailLogoCachedAt = Date.now();

    this.logger.log('Email logo updated', {
      contentType: value.contentType,
      size: value.size,
      updatedBy: userId,
    });

    return value;
  }

  /**
   * Remove the custom email logo so emails fall back to the bundled default.
   */
  async clearEmailLogo(userId?: string): Promise<void> {
    await this.systemSettings.delete(EMAIL_LOGO_KEY);
    this.emailLogoCache = null;
    this.lastEmailLogoCachedAt = Date.now();
    this.logger.log('Email logo removed', { updatedBy: userId });
  }

  private isSupportedEmailLogoContentType(contentType: string): boolean {
    return contentType === 'image/png' || contentType === 'image/jpeg';
  }

  private isEmailLogoValue(value: unknown): value is EmailLogoValue {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as EmailLogoValue).data === 'string' &&
      typeof (value as EmailLogoValue).contentType === 'string' &&
      typeof (value as EmailLogoValue).filename === 'string' &&
      typeof (value as EmailLogoValue).size === 'number'
    );
  }

  async getAppearanceSettings(): Promise<AppearanceSettings> {
    const now = Date.now();
    if (this.appearanceCache && now - this.lastAppearanceCacheUpdate < CACHE_TTL_MS) {
      return this.withLogos(this.appearanceCache);
    }

    return this.withLogos(await this.refreshAppearanceCache());
  }

  invalidateAppearanceCache(): void {
    this.appearanceCache = null;
    this.lastAppearanceCacheUpdate = 0;
  }

  async setAppearanceSettings(settings: AppearanceThemeSettings): Promise<AppearanceSettings> {
    const logos = await this.appearanceLogoService.listPublic();
    for (const theme of APPEARANCE_COLOR_THEMES) {
      if (!this.appearanceLogoService.isKnownLogoId(settings.themes[theme].logo, logos)) {
        throw new BadRequestException(ErrorCode.APPEARANCE_LOGO_NOT_FOUND);
      }
    }

    const value: AppearanceValue = {
      defaultColorTheme: settings.defaultColorTheme,
      themes: settings.themes,
    };

    await this.systemSettings.upsert(APPEARANCE_KEY, value);

    this.appearanceCache = {
      defaultColorTheme: settings.defaultColorTheme,
      themes: settings.themes,
    };
    this.lastAppearanceCacheUpdate = Date.now();
    return { ...this.appearanceCache, logos };
  }

  async getDocumentTreeInjectionSettings(): Promise<DocumentTreeInjectionSettings> {
    const setting = await this.systemSettings.get(DOCUMENT_TREE_INJECTION_KEY);
    const value = setting?.value as Partial<DocumentTreeInjectionSettings> | undefined;
    return {
      enabled: typeof value?.enabled === 'boolean'
        ? value.enabled
        : DEFAULT_DOCUMENT_TREE_INJECTION_SETTINGS.enabled,
    };
  }

  async setDocumentTreeInjectionSettings(enabled: boolean): Promise<DocumentTreeInjectionSettings> {
    const value = { enabled: Boolean(enabled) };
    await this.systemSettings.upsert(DOCUMENT_TREE_INJECTION_KEY, value);
    return value;
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

    await this.systemSettings.upsert(PLAYBOOK_SETTINGS_KEY, value);

    this.playbookSettingsCache = value;
    this.lastPlaybookSettingsCacheUpdate = Date.now();
    return value;
  }

  async applyAppearanceToAllUsers(colorTheme: AppearanceSettings['defaultColorTheme']): Promise<void> {
    await this.userStore.setColorThemeForAll(colorTheme);
    this.logger.log('Applied appearance theme to all users', { colorTheme });
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

    await this.systemSettings.upsert(REGISTRATION_KEY, value);

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

    await this.systemSettings.upsert(REGISTRATION_KEY, value);

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
      const setting = await this.systemSettings.get(REGISTRATION_KEY);

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

  private async refreshAppearanceCache(): Promise<AppearanceThemeSettings> {
    try {
      const setting = await this.systemSettings.get(APPEARANCE_KEY);

      if (setting && this.isAppearanceValue(setting.value)) {
        this.appearanceCache = normalizeAppearanceSettings(setting.value);
      } else {
        this.appearanceCache = DEFAULT_APPEARANCE;
      }

      this.lastAppearanceCacheUpdate = Date.now();
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
      const setting = await this.systemSettings.get(PLAYBOOK_SETTINGS_KEY);
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

  private async withLogos(settings: AppearanceThemeSettings): Promise<AppearanceSettings> {
    const remapUnknown = (themes: AppearanceThemeSettings['themes'], validIds: Set<string>) => {
      const next = { ...themes };
      for (const theme of APPEARANCE_COLOR_THEMES) {
        if (!validIds.has(next[theme].logo)) {
          next[theme] = { ...next[theme], logo: 'yellowmind' };
        }
      }
      return next;
    };

    try {
      const logos = await this.appearanceLogoService.listPublic();
      const validIds = new Set(logos.map((logo) => logo.id));
      return { defaultColorTheme: settings.defaultColorTheme, themes: remapUnknown(settings.themes, validIds), logos };
    } catch (error) {
      this.logger.warn('Failed to load appearance logos', { error: (error as Error).message });
      const logos = [
        { id: 'yellowmind', name: 'Yellowmind', kind: 'builtin' as const },
        { id: 'kpmg', name: 'KPMG', kind: 'builtin' as const },
      ];
      return {
        defaultColorTheme: settings.defaultColorTheme,
        themes: remapUnknown(settings.themes, new Set(logos.map((logo) => logo.id))),
        logos,
      };
    }
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
