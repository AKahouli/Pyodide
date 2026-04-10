export interface AuthProviderPublicResponse {
  type: 'classic' | 'oauth';
  providerKey: string;
  displayName: string;
  iconKey: string;
  sortOrder: number;
  registrationEnabled?: boolean;
}

export interface AuthProviderAdminResponse {
  type: 'classic' | 'oauth';
  id: string;
  providerKey: string;
  displayName: string;
  clientId: string; // Masked '****'
  clientSecret: string; // Masked '****'
  tenantId?: string; // Masked '****'
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  iconKey?: string;
  sortOrder: number;
  pkceEnabled: boolean;
  enabled: boolean;
  linkedUserCount: number;
  registrationEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthCallbackResult {
  type: 'login' | 'link_required';
  // For 'login':
  accessToken?: string;
  expiresIn?: number;
  refreshToken?: string;
  user?: Record<string, unknown>;
  // For 'link_required':
  maskedEmail?: string;
}

export interface OAuthUserInfo {
  sub: string;
  email: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email_verified?: boolean;
}

export interface DecryptedProviderConfig {
  providerKey: string;
  displayName: string;
  clientId: string;
  clientSecret: string;
  tenantId?: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  pkceEnabled: boolean;
  enabled: boolean;
}
