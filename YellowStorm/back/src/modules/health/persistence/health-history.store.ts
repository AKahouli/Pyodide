import type { HealthCheckDetailRecord } from '../schemas/health-history.schema';

/**
 * Store port for ops.health_history (plan 1B.2.4). Fresh start — no
 * backfill; rows expire via the sweeper on expire_at.
 * `_id` and `recordedAt` keep the Mongo field names the admin API returns.
 */

export interface HealthHistoryRow {
  _id: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: Record<string, HealthCheckDetailRecord>;
  recordedAt: Date;
  expireAt: Date;
}

export interface NewHealthHistoryEntry {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: Record<string, HealthCheckDetailRecord>;
}

export interface HealthHistoryRangeOptions {
  from: Date;
  to: Date;
  status?: 'healthy' | 'unhealthy' | 'degraded';
  limit?: number;
  skip?: number;
}

export interface HealthHistoryStore {
  insert(entry: NewHealthHistoryEntry, expireAt: Date): Promise<HealthHistoryRow>;
  findRange(options: HealthHistoryRangeOptions): Promise<{ records: HealthHistoryRow[]; total: number }>;
  /** Unpaged read used by the stats aggregation. */
  findAllInRange(from: Date, to: Date): Promise<HealthHistoryRow[]>;
}
