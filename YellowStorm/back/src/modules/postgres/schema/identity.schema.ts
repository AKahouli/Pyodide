import { sql } from 'drizzle-orm';
import { boolean, char, check, index, integer, jsonb, pgSchema, primaryKey, smallint, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';
import { authzRoles } from './authz.schema';

/** P1A identity tables (plan 2026-09-19 step 1A). Cutover replaces Mongo users/sessions/auth-providers/user_groups. */
export const identitySchema = pgSchema('identity');

export const identityUsers = identitySchema.table(
  'users',
  {
    id: objectId('id').primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    emailVerificationToken: text('email_verification_token'),
    emailVerificationExpiry: timestamp('email_verification_expiry', { withTimezone: true }),
    passwordResetToken: text('password_reset_token'),
    passwordResetExpiry: timestamp('password_reset_expiry', { withTimezone: true }),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    company: varchar('company', { length: 200 }),
    profileRole: varchar('profile_role', { length: 200 }).notNull().default(''),
    description: varchar('description', { length: 1000 }).notNull().default(''),
    colorTheme: varchar('color_theme', { length: 16 }).notNull().default('default'),
    language: varchar('language', { length: 16 }).notNull().default('en'),
    consentPrivacyPolicy: boolean('consent_privacy_policy').notNull().default(false),
    consentPrivacyPolicyAcceptedAt: timestamp('consent_privacy_policy_accepted_at', { withTimezone: true }),
    consentDataSharing: boolean('consent_data_sharing').notNull().default(false),
    consentDataSharingAcceptedAt: timestamp('consent_data_sharing_accepted_at', { withTimezone: true }),
    profileComplete: boolean('profile_complete').notNull().default(false),
    microsoftAccountId: varchar('microsoft_account_id', { length: 255 }),
    /** FK → catalog.plans is added in 1B.3. */
    planId: objectId('plan_id'),
    planSlug: varchar('plan_slug', { length: 50 }),
    planStartedAt: timestamp('plan_started_at', { withTimezone: true }),
    permissionsVersion: integer('permissions_version').notNull().default(1),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    registrationApproval: varchar('registration_approval', { length: 16 }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('uq_users_email_shape', sql`${t.email} = lower(btrim(${t.email}))`),
    check('users_color_theme_enum', sql`${t.colorTheme} IN ('default','yellow','orange','blue')`),
    check('users_status_enum', sql`${t.status} IN ('active','inactive','suspended')`),
    check('users_registration_approval_enum', sql`${t.registrationApproval} IS NULL OR ${t.registrationApproval} IN ('pending','approved','rejected')`),
    uniqueIndex('uq_users_email').on(t.email),
    index('idx_users_microsoft_account').on(t.microsoftAccountId).where(sql`${t.microsoftAccountId} IS NOT NULL`),
    index('idx_users_plan').on(t.planId),
    index('idx_users_status').on(t.status),
    index('idx_users_created').on(t.createdAt.desc()),
    index('idx_users_email_verification_token').on(t.emailVerificationToken).where(sql`${t.emailVerificationToken} IS NOT NULL`),
    index('idx_users_password_reset_token').on(t.passwordResetToken).where(sql`${t.passwordResetToken} IS NOT NULL`),
    index('idx_users_email_trgm').using('gin', sql`${t.email} gin_trgm_ops`),
    index('idx_users_first_name_trgm').using('gin', sql`${t.firstName} gin_trgm_ops`),
    index('idx_users_last_name_trgm').using('gin', sql`${t.lastName} gin_trgm_ops`),
  ],
);

/** `users.roles[]` → junction; `position` keeps the array order (roleNames claim order). */
export const identityUserRoles = identitySchema.table(
  'user_roles',
  {
    userId: objectId('user_id')
      .notNull()
      .references(() => identityUsers.id, { onDelete: 'cascade' }),
    roleId: objectId('role_id')
      .notNull()
      .references(() => authzRoles.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index('idx_user_roles_role').on(t.roleId)],
);

export const identitySessions = identitySchema.table(
  'sessions',
  {
    id: objectId('id').primaryKey(),
    userId: objectId('user_id')
      .notNull()
      .references(() => identityUsers.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    deviceInfo: jsonb('device_info').$type<Record<string, unknown>>().notNull(),
    ipAddress: varchar('ip_address', { length: 64 }).notNull(),
    isValid: boolean('is_valid').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    tokenFamily: varchar('token_family', { length: 64 }).notNull(),
    rotatedFromSessionId: objectId('rotated_from_session_id'),
    rotatedToSessionId: objectId('rotated_to_session_id'),
    rotationAttemptId: varchar('rotation_attempt_id', { length: 128 }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    rotationReceiptExpiresAt: timestamp('rotation_receipt_expires_at', { withTimezone: true }),
    rotationReceiptCiphertext: text('rotation_receipt_ciphertext'),
    rotationReceiptKeyId: varchar('rotation_receipt_key_id', { length: 64 }),
    ...timestamps(),
  },
  (t) => [
    index('idx_sessions_user_valid').on(t.userId, t.isValid),
    index('idx_sessions_user_ip').on(t.userId, t.ipAddress),
    index('idx_sessions_expires').on(t.expiresAt),
    index('idx_sessions_token_family').on(t.tokenFamily),
    uniqueIndex('uq_sessions_rotated_from').on(t.rotatedFromSessionId).where(sql`${t.rotatedFromSessionId} IS NOT NULL`),
  ],
);

/** client_id/client_secret/tenant_id are CryptoService ciphertext — opaque, never transformed. */
export const identityAuthProviders = identitySchema.table(
  'auth_providers',
  {
    id: objectId('id').primaryKey(),
    providerKey: varchar('provider_key', { length: 50 }).notNull(),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret').notNull(),
    tenantId: text('tenant_id'),
    authorizationUrl: text('authorization_url').notNull(),
    tokenUrl: text('token_url').notNull(),
    userinfoUrl: text('userinfo_url').notNull(),
    scopes: text('scopes').array().notNull().default(['openid', 'email', 'profile']),
    iconKey: varchar('icon_key', { length: 50 }),
    sortOrder: integer('sort_order').notNull().default(0),
    pkceEnabled: boolean('pkce_enabled').notNull().default(true),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check('auth_providers_key_shape', sql`${t.providerKey} = lower(btrim(${t.providerKey}))`),
    uniqueIndex('uq_auth_providers_key').on(t.providerKey),
    index('idx_auth_providers_enabled_sort').on(t.enabled, t.sortOrder),
  ],
);

export const identityOauthStates = identitySchema.table(
  'oauth_states',
  {
    id: objectId('id').primaryKey(),
    state: varchar('state', { length: 256 }).notNull(),
    providerKey: varchar('provider_key', { length: 50 }).notNull(),
    codeVerifier: text('code_verifier'),
    returnUrl: text('return_url'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_oauth_states_state').on(t.state), index('idx_oauth_states_expires').on(t.expiresAt)],
);

/** Also holds temp-login tokens (sentinel provider_key '__temp_login__'). */
export const identityProviderLinkTokens = identitySchema.table(
  'provider_link_tokens',
  {
    id: objectId('id').primaryKey(),
    token: varchar('token', { length: 256 }).notNull(),
    userId: objectId('user_id')
      .notNull()
      .references(() => identityUsers.id, { onDelete: 'cascade' }),
    providerKey: varchar('provider_key', { length: 50 }).notNull(),
    providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
    providerEmail: varchar('provider_email', { length: 320 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_provider_link_tokens_token').on(t.token),
    index('idx_provider_link_tokens_user').on(t.userId),
    index('idx_provider_link_tokens_expires').on(t.expiresAt),
  ],
);

export const identityUserProviderLinks = identitySchema.table(
  'user_provider_links',
  {
    id: objectId('id').primaryKey(),
    userId: objectId('user_id')
      .notNull()
      .references(() => identityUsers.id, { onDelete: 'cascade' }),
    providerKey: varchar('provider_key', { length: 50 }).notNull(),
    providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
    providerEmail: varchar('provider_email', { length: 320 }).notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_user_provider_links_provider').on(t.providerKey, t.providerUserId),
    index('idx_user_provider_links_user').on(t.userId),
  ],
);

export const identityUserGroups = identitySchema.table(
  'user_groups',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 2000 }).notNull().default(''),
    /** Users are never hard-deleted → default NO ACTION (plan global constraint). */
    createdBy: objectId('created_by')
      .notNull()
      .references(() => identityUsers.id),
    ...timestamps(),
  },
  (t) => [
    check('user_groups_name_min_length', sql`char_length(${t.name}) >= 2`),
    uniqueIndex('uq_user_groups_owner_name').on(t.name, t.createdBy),
    index('idx_user_groups_created_by').on(t.createdBy),
  ],
);

export const identityUserGroupMembers = identitySchema.table(
  'user_group_members',
  {
    groupId: objectId('group_id')
      .notNull()
      .references(() => identityUserGroups.id, { onDelete: 'cascade' }),
    userId: objectId('user_id')
      .notNull()
      .references(() => identityUsers.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index('idx_user_group_members_user').on(t.userId)],
);
