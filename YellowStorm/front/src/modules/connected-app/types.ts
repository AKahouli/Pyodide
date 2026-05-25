export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error';

export interface ConnectedAppPublic {
  appKey: string;
  displayName: string;
  description?: string;
  iconKey?: string;
  scopes: string[];
  sortOrder: number;
}

export interface UserConnectionInfo {
  appKey: string;
  displayName: string;
  iconKey?: string;
  status: ConnectionStatus;
  scopes: string[];
  providerEmail?: string;
  connectedAt: string;
}

export interface ConnectedAppWithStatus extends ConnectedAppPublic {
  connected: boolean;
  connection?: UserConnectionInfo;
}

export interface MailboxCapability {
  appKey: string;
  connected: boolean;
  mailboxReady: boolean;
  providerEmail?: string;
  missingScopes: string[];
  grantedScopes: string[];
}

export interface ConnectedAppAdminResponse {
  id: string;
  appKey: string;
  authType: 'oauth2' | 'api_key';
  displayName: string;
  description?: string;
  iconKey?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
  scopes: string[];
  pkceEnabled: boolean;
  apiKey?: string;
  enabled: boolean;
  sortOrder: number;
  connectedUserCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectedAppDefinition {
  appKey: string;
  displayName: string;
  description?: string;
  iconKey?: string;
  authorizationUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  clientId: string;
  clientSecret: string;
  tenantId?: string;
  scopes: string[];
  pkceEnabled?: boolean;
  enabled?: boolean;
  sortOrder?: number;
}

export type UpdateConnectedAppDefinition = Partial<CreateConnectedAppDefinition>;

export interface OAuthPopupResult {
  type: 'connected-app-oauth-result';
  appKey: string;
  success: boolean;
  error?: string;
}
