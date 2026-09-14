export type CatalogConflictPolicy = 'skip' | 'overwrite';

export interface CatalogCategoryRecord {
  name: string;
  description: string;
  isSystem: boolean;
}

export interface CatalogSkillRecord {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: 'light' | 'dark';
  categoryName: string | null;
  license: string;
  compatibility: string;
  metadata: Record<string, string>;
  allowedTools: string[];
  instructions: string;
  files: Array<{ path: string; kind: string; mimeType: string; content: string }>;
  isActive: boolean;
}

export interface CatalogConnectorRecord {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: 'light' | 'dark';
  categoryName: string | null;
  authType: string;
  authConfigSchema: Record<string, unknown>;
  authSourceType: string;
  connectedAppKey: string;
  runtimeAuthConfig: Record<string, unknown>;
  mcpTransportType: string;
  mcpServerUrl: string;
  mcpServerConfig: Record<string, unknown>;
  dynamicHeaders: Array<{ headerName: string; source: string; enabled: boolean }>;
  actions: Array<{
    key: string;
    label: string;
    description: string;
    parameterSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    safety: string;
    supportsBatch: boolean;
    supportsIteration: boolean;
    isEnabled: boolean;
    resultKind?: string;
    citationMode?: string;
    resultMapping?: Record<string, unknown>;
  }>;
  referencedSkillSlugs: string[];
  isActive: boolean;
  isSystem: boolean;
  isHidden: boolean;
}

export interface CatalogSecurityRecord {
  connectorCredentials: Array<{
    connectorSlug: string;
    displayName: string;
    authPayload: Record<string, unknown>;
    status: string;
    lastValidatedAt: string | null;
    expiresAt: string | null;
  }>;
  connectedAppDefinitions: Array<{
    appKey: string;
    displayName: string;
    description: string;
    iconKey: string;
    authorizationUrl: string;
    tokenUrl: string;
    revokeUrl: string;
    clientId: string;
    clientSecret: string;
    tenantId: string;
    scopes: string[];
    pkceEnabled: boolean;
    enabled: boolean;
    sortOrder: number;
  }>;
  userAppConnections: Array<{
    appKey: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: string | null;
    scopes: string[];
    providerAccountId: string;
    providerEmail: string;
    status: string;
    lastUsedAt: string | null;
    lastRefreshedAt: string | null;
    errorMessage: string;
  }>;
  adminConnectorAuth: Array<{
    appKey: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: string | null;
    scopes: string[];
    providerAccountId: string;
    providerEmail: string;
    connected: boolean;
    status: string;
    disconnectedAt: string | null;
    lastUsedAt: string | null;
    lastRefreshedAt: string | null;
    errorMessage: string;
  }>;
}

export interface CatalogArchiveV1 {
  format: 'yellowstorm-catalog';
  version: 1;
  resource: 'connectors' | 'skills';
  exportedAt: string;
  securityIncluded: boolean;
  connectorCategories: CatalogCategoryRecord[];
  skillCategories: CatalogCategoryRecord[];
  skills: CatalogSkillRecord[];
  connectors: CatalogConnectorRecord[];
  security?: CatalogSecurityRecord;
}

export interface EncryptedCatalogArchive {
  format: 'yellowstorm-catalog-encrypted';
  version: 1;
  algorithm: 'aes-256-gcm';
  kdf: 'scrypt';
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export interface CatalogImportResult {
  skills: { created: number; updated: number; skipped: number };
  connectors: { created: number; updated: number; skipped: number };
  categories: { created: number; reused: number };
  security: { credentials: number; connectedApps: number; tokens: number };
}
