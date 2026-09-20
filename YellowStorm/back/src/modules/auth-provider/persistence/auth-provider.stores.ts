/** Row shapes for identity.auth_providers / oauth_states / provider_link_tokens / user_provider_links. */
export interface AuthProviderRecord {
  id: string;
  providerKey: string;
  displayName: string;
  clientId: string;
  clientSecret: string;
  tenantId: string | null;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  iconKey: string | null;
  sortOrder: number;
  pkceEnabled: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type AuthProviderPatch = Partial<
  Omit<AuthProviderRecord, 'id' | 'providerKey' | 'createdAt' | 'updatedAt'>
>;

export const AUTH_PROVIDER_STORE = Symbol('AUTH_PROVIDER_STORE');

export interface AuthProviderStore {
  findAll(): Promise<AuthProviderRecord[]>;
  findAllEnabled(): Promise<AuthProviderRecord[]>;
  findById(id: string): Promise<AuthProviderRecord | null>;
  findByKey(providerKey: string): Promise<AuthProviderRecord | null>;
  existsByKey(providerKey: string, excludeId?: string): Promise<boolean>;
  create(init: Omit<AuthProviderRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<AuthProviderRecord>;
  update(id: string, patch: AuthProviderPatch): Promise<AuthProviderRecord | null>;
  deleteById(id: string): Promise<boolean>;
}

export interface OAuthStateRecord {
  id: string;
  state: string;
  providerKey: string;
  codeVerifier: string | null;
  returnUrl: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const OAUTH_STATE_STORE = Symbol('OAUTH_STATE_STORE');

export interface OAuthStateStore {
  create(init: Omit<OAuthStateRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<OAuthStateRecord>;
  /**
   * One-shot consumption: deletes and returns the state row only when it is
   * still valid (expires_at > now). Mongo parity gains the strict expiry
   * check the TTL index only approximated (plan 1A.5).
   */
  consumeByState(state: string): Promise<OAuthStateRecord | null>;
}

export interface ProviderLinkTokenRecord {
  id: string;
  token: string;
  userId: string;
  providerKey: string;
  providerUserId: string;
  providerEmail: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const PROVIDER_LINK_TOKEN_STORE = Symbol('PROVIDER_LINK_TOKEN_STORE');

export interface ProviderLinkTokenStore {
  create(init: Omit<ProviderLinkTokenRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderLinkTokenRecord>;
  /** One-shot + expiry-strict, as consumeByState. */
  consumeByToken(token: string): Promise<ProviderLinkTokenRecord | null>;
  consumeByTokenAndProviderKey(token: string, providerKey: string): Promise<ProviderLinkTokenRecord | null>;
}

export interface UserProviderLinkRecord {
  id: string;
  userId: string;
  providerKey: string;
  providerUserId: string;
  providerEmail: string;
  linkedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const USER_PROVIDER_LINK_STORE = Symbol('USER_PROVIDER_LINK_STORE');

export interface UserProviderLinkStore {
  findByProvider(providerKey: string, providerUserId: string): Promise<UserProviderLinkRecord | null>;
  findByUserId(userId: string): Promise<UserProviderLinkRecord[]>;
  create(init: Omit<UserProviderLinkRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserProviderLinkRecord>;
  deleteByUserAndProvider(userId: string, providerKey: string): Promise<boolean>;
  countByUserExcluding(userId: string, providerKey: string): Promise<number>;
}
