/** Plain connector types (remediation 4.1) — moved out of the connector schemas. */
export enum ConnectorActionSafety {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
}

export enum ConnectorActionResultKind {
  GENERIC = 'generic',
  WEB_SEARCH = 'web_search',
  WEB_FETCH = 'web_fetch',
  DOCUMENT_SEARCH = 'document_search',
  FILE_READ = 'file_read',
  DATABASE_QUERY = 'database_query',
}

export enum ConnectorCitationMode {
  NONE = 'none',
  SOURCE_ONLY = 'source_only',
  TEXT_FRAGMENT = 'text_fragment',
  DOCUMENT_EVIDENCE = 'document_evidence',
}

export enum ConnectorAuthType {
  OAUTH2 = 'oauth2',
  API_KEY = 'api_key',
  TOKEN = 'token',
  BASIC = 'basic',
  NONE = 'none',
}

export enum ConnectorAuthSourceType {
  CONNECTED_APP = 'connected_app',
  CREDENTIAL = 'credential',
  NONE = 'none',
  SERVER_CONFIG = 'server_config',
}

export enum RuntimeAuthStrategy {
  HTTP_HEADER_BEARER = 'http_header_bearer',
  CUSTOM_HEADERS = 'custom_headers',
  ENV_VARS = 'env_vars',
}

export enum McpTransportType {
  STDIO = 'stdio',
  SSE = 'sse',
  STREAMABLE_HTTP = 'streamable_http',
}

export enum DynamicHeaderSource {
  WORKSPACE = 'workspace',
  USER_ID = 'user_id',
  USER_EMAIL = 'user_email',
  USER_FIRST_NAME = 'user_first_name',
  USER_LAST_NAME = 'user_last_name',
  USER_FULL_NAME = 'user_full_name',
}

export enum AdminConnectorAuthStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  ERROR = 'error',
}

/** Data shape of one connector action (stored as jsonb in Postgres). */
export interface ConnectorDynamicHeader {
  headerName: string;
  source: DynamicHeaderSource;
  enabled: boolean;
}

/** Data shape of one connector action (stored as jsonb in Postgres). */
export interface ConnectorAction {
  key: string;
  label: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  safety: ConnectorActionSafety;
  supportsBatch: boolean;
  supportsIteration: boolean;
  isEnabled: boolean;
  resultKind: ConnectorActionResultKind;
  citationMode: ConnectorCitationMode;
  resultMapping?: Record<string, unknown>;
}
