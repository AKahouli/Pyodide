import { registerAs } from '@nestjs/config';

/**
 * Persistent App Data — PostgreSQL-backed tenant schemas per generated app.
 * All sub-features are gated independently; defaults keep current behaviour.
 */
export default registerAs('appData', () => ({
  /** Master switch — when false, no app-data routes or provisioning run. */
  enabled: process.env.APP_DATA_ENABLED === 'true',
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
  /** Public API rate limit per appDataId+IP (requests per minute). */
  publicRateLimitPerMinute: parseInt(
    process.env.APP_DATA_PUBLIC_RATE_LIMIT_PER_MINUTE || '120',
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
