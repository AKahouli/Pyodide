import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SystemSetting, SystemSettingDocument, MaintenanceValue, RegistrationValue } from './schemas/system-setting.schema';
import { MaintenanceStatus } from './interfaces/maintenance.interface';
import { RegistrationStatus } from './interfaces/registration.interface';
import { LoggerService } from '../logger';

const MAINTENANCE_KEY = 'maintenance_mode';
const REGISTRATION_KEY = 'registration_settings';
const CACHE_TTL_MS = 5000; // 5 seconds

@Injectable()
export class SystemService implements OnApplicationBootstrap {
  private maintenanceCache: MaintenanceStatus | null = null;
  private registrationCache: RegistrationStatus | null = null;
  private lastCacheUpdate = 0;
  private lastRegistrationCacheUpdate = 0;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectModel(SystemSetting.name)
    private readonly systemSettingModel: Model<SystemSettingDocument>,
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
      ]);
      this.logger.log('System service initialized', {
        maintenanceEnabled: this.maintenanceCache?.enabled ?? false,
        registrationEnabled: this.registrationCache?.enabled ?? true,
      });

      // Start periodic refresh
      this.refreshInterval = setInterval(() => {
        this.refreshMaintenanceCache().catch((err) => {
          this.logger.warn('Periodic maintenance cache refresh failed', { error: err.message });
        });
        this.refreshRegistrationCache().catch((err) => {
          this.logger.warn('Periodic registration cache refresh failed', { error: err.message });
        });
      }, CACHE_TTL_MS);
    } catch (error) {
      this.logger.warn('Failed to initialize system service', { error: (error as Error).message });
      // Initialize with safe defaults
      this.maintenanceCache = { enabled: false, message: '' };
      this.registrationCache = { enabled: true };
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
    };
    this.lastRegistrationCacheUpdate = Date.now();

    this.logger.log(`Registration ${enabled ? 'enabled' : 'disabled'}`, {
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
        };
      } else {
        this.registrationCache = { enabled: true };
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
