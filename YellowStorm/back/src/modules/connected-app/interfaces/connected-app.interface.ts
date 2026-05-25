import { ConnectionStatus } from '../schemas/user-app-connection.schema';
import { ConnectedAppAuthType } from '../schemas/connected-app-definition.schema';

export interface DecryptedAppConfig {
  appKey: string;
  authType: ConnectedAppAuthType;
  displayName: string;
  description?: string;
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
}

export interface ConnectedAppPublicResponse {
  appKey: string;
  displayName: string;
  description?: string;
  iconKey?: string;
  scopes: string[];
  sortOrder: number;
  authType: ConnectedAppAuthType;
}

export interface ConnectedAppAdminResponse {
  id: string;
  appKey: string;
  authType: ConnectedAppAuthType;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface UserConnectionResponse {
  appKey: string;
  displayName: string;
  iconKey?: string;
  status: ConnectionStatus;
  scopes: string[];
  providerEmail?: string;
  connectedAt: Date;
}

export interface ConnectedAppWithStatus extends ConnectedAppPublicResponse {
  connected: boolean;
  connection?: UserConnectionResponse;
}

export interface MailboxCapabilityResponse {
  appKey: string;
  connected: boolean;
  mailboxReady: boolean;
  providerEmail?: string;
  missingScopes: string[];
  grantedScopes: string[];
}
