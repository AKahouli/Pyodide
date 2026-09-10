import { registerAs } from '@nestjs/config';

/**
 * Persistent App Data — PostgreSQL-backed tenant schemas per generated app.
 * All sub-features are gated independently; defaults keep current behaviour.
 */
export default registerAs('appData', () => ({
  /** Master switch — when false, no app-data routes or provisioning run. */
  enabled: process.env.APP_DATA_ENABLED === 'true',
  /**
   * Delegate app-data to the standalone app-data microservice over HTTP.
   * When true, provisioning / release binding / public CRUD / owner Data tab
   * are proxied to APP_DATA_SERVICE_URL and local tenant-schema services are
   * not registered. Set to false to restore monolith-local behaviour.
   */
  remote: (() => {
    const raw = process.env.APP_DATA_REMOTE;
    if (raw === undefined || raw === '') return false;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    console.warn(
      `[AppDataModule] APP_DATA_REMOTE="${raw}" is not a recognised value — ` +
        `expected "true" or "false". Falling back to local mode.`,
    );
    return false;
  })(),
  /** Base URL of the app-data microservice (internal, server-to-server). */
  serviceUrl: process.env.APP_DATA_SERVICE_URL || '',
  /** Static service token expected by the microservice (Authorization: Bearer). */
  serviceToken: process.env.APP_DATA_SERVICE_TOKEN || '',
  /** Externally reachable base URL of the microservice for generated apps. */
  remotePublicBaseUrl: process.env.APP_DATA_REMOTE_PUBLIC_BASE_URL || '',
  /**
   * Public HTTPS base URL of the microservice for PROD deployed apps
   * (e.g. https://app-data.yellowsys.org behind a reverse proxy). Required
   * when deploying in NODE_ENV=production — an https page cannot call an
   * http:// base (mixed content) and localhost never reaches visitors.
   */
  remotePublicBaseUrlProd: process.env.APP_DATA_REMOTE_PUBLIC_BASE_URL_PROD || '',
  /** Default HTTP timeout for microservice calls (ms). */
  remoteTimeoutMs: parseInt(process.env.APP_DATA_REMOTE_TIMEOUT_MS || '15000', 10),
  /** HTTP timeout for release binding (copies all rows DEV→PROD) (ms). */
  remoteBindTimeoutMs: parseInt(process.env.APP_DATA_REMOTE_BIND_TIMEOUT_MS || '120000', 10),
  /** POST /mcp/app-data JSON-RPC endpoint. */
  mcpEnabled: process.env.APP_DATA_MCP_ENABLED === 'true',
  /** Policy-driven HTTP CRUD for generated React apps. */
  publicApiEnabled: process.env.APP_DATA_PUBLIC_API_ENABLED === 'true',
  /** Owner read-only Data tab in Conversation V2. */
  dataTabEnabled: process.env.APP_DATA_DATA_TAB_ENABLED === 'true',
  /** Public base URL for generated apps in dev preview (VITE_YM_APP_DATA_URL). */
  publicBaseUrl:
    process.env.APP_DATA_PUBLIC_BASE_URL ||
    process.env.APP_RUNTIME_PUBLIC_BASE_URL ||
    '',
  /** Public base URL for PROD deployed apps. Falls back to publicBaseUrl. */
  publicBaseUrlProd:
    process.env.APP_DATA_PUBLIC_BASE_URL_PROD || '',
  /** Max tables per app schema manifest. */
  maxTables: parseInt(process.env.APP_DATA_MAX_TABLES || '32', 10),
  /** Max columns per table. */
  maxColumns: parseInt(process.env.APP_DATA_MAX_COLUMNS || '64', 10),
  /** Max row body bytes on public API insert/update. */
  maxRowBodyBytes: parseInt(process.env.APP_DATA_MAX_ROW_BODY_BYTES || '65536', 10),
  /** Default page size for list/query endpoints. */
  defaultPageSize: parseInt(process.env.APP_DATA_DEFAULT_PAGE_SIZE || '50', 10),
  /** Hard cap on page size. */
  maxPageSize: parseInt(process.env.APP_DATA_MAX_PAGE_SIZE || '200', 10),
  /** Public API GET rate limit per appDataId+IP+table (requests per minute). */
  publicRateLimitPerMinute: parseInt(
    process.env.APP_DATA_PUBLIC_RATE_LIMIT_PER_MINUTE || '600',
    10,
  ),
  /** Statement timeout for tenant DDL/DML (ms). */
  statementTimeoutMs: parseInt(process.env.APP_DATA_STATEMENT_TIMEOUT_MS || '30000', 10),
  /** MCP URL returned on internal bind when MCP is enabled. */
  mcpUrl: process.env.APP_DATA_MCP_URL || '',
  /** App end-user register/login JWT for generated apps. */
  endUserAuthEnabled: process.env.APP_DATA_END_USER_AUTH_ENABLED !== 'false',
  /** JWT TTL for app end-users (e.g. 7d, 24h). */
  endUserJwtTtl: process.env.APP_DATA_END_USER_JWT_TTL || '7d',
  /** bcrypt rounds for app end-user passwords. */
  endUserBcryptRounds: parseInt(process.env.APP_DATA_END_USER_BCRYPT_ROUNDS || '12', 10),
}));
