/**
 * Profile Module Types
 */

// Settings modal section types
export type SettingsSection = 'profile' | 'sessions' | 'appearance' | 'data-controls' | 'usage' | 'health';

// Session info from backend
export interface Session {
  id: string;
  deviceInfo: {
    browser?: string;
    os?: string;
    device?: string;
  };
  ipAddress: string;
  lastActivityAt: string;
  createdAt: string;
  isCurrent: boolean;
}

// Profile update data
export interface UpdateProfileData {
  firstName?: string;
  lastName?: string;
  company?: string;
  role?: string;
  description?: string;
}

// Appearance settings
export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppearanceSettings {
  theme: ThemeMode;
}

// Data controls
export interface DataControlsSettings {
  dataSharing: boolean;
}

// Settings modal context
export interface SettingsModalContextType {
  isOpen: boolean;
  activeSection: SettingsSection;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setActiveSection: (section: SettingsSection) => void;
}

// Health check types
export interface HealthCheckDetail {
  status: 'up' | 'down' | 'degraded';
  responseTime?: number;
  message?: string;
  lastChecked: string;
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: Record<string, HealthCheckDetail>;
}

// Health history types
export interface HealthHistoryRecord extends HealthCheckResult {
  _id: string;
  recordedAt: string;
  expireAt: string;
}

export interface HealthHistoryResponse {
  records: HealthHistoryRecord[];
  total: number;
  query: {
    from: string;
    to: string;
    minutes: number;
  };
}

export interface HealthHistoryStats {
  totalRecords: number;
  uptimePercentage: number;
  avgResponseTimes: Record<string, number>;
  statusBreakdown: {
    healthy: number;
    unhealthy: number;
    degraded: number;
  };
  period: {
    from: string;
    to: string;
    minutes: number;
  };
}
