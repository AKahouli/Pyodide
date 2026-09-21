/**
 * Check-detail shape of ops.health_history.checks
 * (types only since the 1B.2 PostgreSQL cutover).
 */
export interface HealthCheckDetailRecord {
  status: 'up' | 'down' | 'degraded';
  responseTime?: number;
  message?: string;
  lastChecked: string;
}
