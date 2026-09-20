import { AuthUserRegistrationApproval, AuthUserStatus } from '@common/auth/auth-user';

/**
 * Flat row shape of identity.users (step 1A). Mongo and PG stores both emit
 * it; user-record.mapper turns it into the wire / AuthUser / summary shapes.
 * Secrets (passwordHash, one-time tokens) travel inside the record but never
 * reach a mapper output.
 */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  emailVerificationToken: string | null;
  emailVerificationExpiry: Date | null;
  passwordResetToken: string | null;
  passwordResetExpiry: Date | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  profileRole: string;
  description: string;
  colorTheme: 'default' | 'yellow' | 'orange' | 'blue';
  language: string;
  consentPrivacyPolicy: boolean;
  consentPrivacyPolicyAcceptedAt: Date | null;
  consentDataSharing: boolean;
  consentDataSharingAcceptedAt: Date | null;
  profileComplete: boolean;
  microsoftAccountId: string | null;
  planId: string | null;
  planSlug: string | null;
  planStartedAt: Date | null;
  roleIds: string[];
  permissionsVersion: number;
  status: AuthUserStatus;
  registrationApproval: AuthUserRegistrationApproval | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Role id + name, populated for admin views (listAdmin / findByIdWithRoles). */
export interface RoleRef {
  id: string;
  name: string;
}

export type UserRecordWithRoles = UserRecord & { roles: RoleRef[] };

export interface NewUser {
  email: string;
  passwordHash: string;
  emailVerified?: boolean;
  emailVerificationToken?: string;
  emailVerificationExpiry?: Date;
  firstName?: string;
  lastName?: string;
  company?: string;
  profileRole?: string;
  description?: string;
  microsoftAccountId?: string;
  profileComplete?: boolean;
  status?: AuthUserStatus;
  registrationApproval?: AuthUserRegistrationApproval;
  roleIds?: string[];
}

/**
 * Explicit column patch for update(). `null` clears a nullable column
 * (mirrors Mongo's save-with-undefined); absent keys are untouched.
 */
export type UserPatch = Partial<{
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  emailVerificationToken: string | null;
  emailVerificationExpiry: Date | null;
  passwordResetToken: string | null;
  passwordResetExpiry: Date | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  profileRole: string;
  description: string;
  colorTheme: 'default' | 'yellow' | 'orange' | 'blue';
  language: string;
  consentPrivacyPolicy: boolean;
  consentPrivacyPolicyAcceptedAt: Date | null;
  consentDataSharing: boolean;
  consentDataSharingAcceptedAt: Date | null;
  profileComplete: boolean;
  microsoftAccountId: string | null;
  planId: string | null;
  planSlug: string | null;
  planStartedAt: Date | null;
  permissionsVersion: number;
  status: AuthUserStatus;
  registrationApproval: AuthUserRegistrationApproval | null;
  lastLoginAt: Date | null;
}>;

export interface UserSearchHit {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface AdminUserFilter {
  search?: string;
  status?: AuthUserStatus;
  emailVerified?: boolean;
  profileComplete?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'email' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export const USER_STORE = Symbol('USER_STORE');

/**
 * Persistence port for the user identity (step 1A.1). Backed by Mongo until
 * the 1A cutover, by identity.users afterwards; callers never change.
 */
export interface UserStore {
  findById(id: string): Promise<UserRecord | null>;
  findByIds(ids: string[]): Promise<Map<string, UserRecord>>;
  findByIdWithRoles(id: string): Promise<UserRecordWithRoles | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findByEmails(emails: string[]): Promise<Map<string, UserRecord>>;
  findByVerificationToken(token: string): Promise<UserRecord | null>;
  findByResetTokenHash(tokenHash: string): Promise<UserRecord | null>;
  findByMicrosoftAccountId(microsoftAccountId: string): Promise<UserRecord | null>;
  existsByEmail(email: string): Promise<boolean>;
  create(init: NewUser): Promise<UserRecord>;
  /** Sets the given columns plus updated_at = now(). */
  update(id: string, patch: UserPatch): Promise<UserRecord | null>;
  /** Active users matching q (case-insensitive substring) on email/first/last name. */
  searchActive(q: string, options: { excludeUserId?: string; limit: number }): Promise<UserSearchHit[]>;
  /** Active users ordered by email (directory listing). */
  listActive(options: { excludeUserId?: string; limit: number }): Promise<UserSearchHit[]>;
  findWithoutPlan(limit: number): Promise<UserRecord[]>;
  listAdmin(filter: AdminUserFilter): Promise<{ users: UserRecordWithRoles[]; total: number }>;
  countByStatus(): Promise<Record<AuthUserStatus, number>>;
  findActiveByRole(roleId: string): Promise<UserRecord[]>;
  setColorThemeForAll(theme: 'default' | 'yellow' | 'orange' | 'blue'): Promise<void>;
  addRole(userId: string, roleId: string): Promise<void>;
  removeRole(userId: string, roleId: string): Promise<void>;
  removeRoleFromAll(roleId: string): Promise<void>;
  bumpPermissionsVersion(userIds: string[]): Promise<void>;
}
