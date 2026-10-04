/**
 * Value shapes stored in catalog.system_settings `value` jsonb
 * (types only since the 1B.2 PostgreSQL cutover).
 */
export interface MaintenanceValue {
  enabled: boolean;
  message: string;
  startedAt?: Date;
  startedBy?: string;
  estimatedEndAt?: Date;
}

export interface RegistrationValue {
  enabled: boolean;
  disabledAt?: Date;
  disabledBy?: string;
  classicAuthEnabled?: boolean;
}

export interface AppearanceThemeValue {
  labelKey: string;
  logo: string;
}

export interface AppearanceValue {
  defaultColorTheme: string;
  themes: Record<string, AppearanceThemeValue>;
}

export interface CorsSettingsValue {
  origins: { origin: string; enabled: boolean }[];
}

export interface LoginSettingsValue {
  accessExpiry: string;
  refreshExpiry: string;
}

export interface EmailLogoValue {
  data: string;
  contentType: string;
  filename: string;
  size: number;
  updatedAt: Date;
  updatedBy?: string;
}
