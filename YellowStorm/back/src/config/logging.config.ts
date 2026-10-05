import { registerAs } from '@nestjs/config';

// P11 retired the SQL write path: the buffer/persistence/display keys are gone. The
// LOGGING_* env vars for them stay in config.schema.ts so existing .env files still validate.
export default registerAs('logging', () => {
  return {
    // How long persisted logs are kept (swept hourly from ops.logs). The Mongo TTL index was 30 days by
    // default; a busy dev environment writes several hundred thousand entries a day and may want fewer.
    retentionDays: Math.max(1, Number.parseInt(process.env.LOGGING_RETENTION_DAYS || '30', 10) || 30),

    // Unified-logging read-side cutover (P07): the admin log API serves HISTORIC rows only.
    // historicCutoverAt marks the moment live events moved to Grafana (unset = not yet cut over).
    historicCutoverAt: process.env.LOGGING_HISTORIC_CUTOVER_AT || null,

    // Allowlisted Grafana origin + dashboard UID used to build the "open live logs" link.
    grafanaBaseUrl: process.env.OBS_GRAFANA_BASE_URL || null,
    grafanaDashboardUid: process.env.OBS_GRAFANA_DASHBOARD_UID || null,
  };
});
