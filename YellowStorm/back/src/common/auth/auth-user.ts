/**
 * Plain, framework-free shape of the authenticated user returned by
 * JwtStrategy.validate and injected by @CurrentUser().
 *
 * Replaces `UserDocument` in type positions across modules so the identity
 * storage can move to PostgreSQL without touching consumers. `_id`/`id` are
 * strings; `String(x)`, `x.toString()` and `new Types.ObjectId(x)` keep
 * working on either storage.
 */
export interface AuthUserProfile {
  firstName?: string;
  lastName?: string;
  company?: string;
  role?: string;
  description?: string;
}

export interface AuthUserAppearance {
  colorTheme: 'default' | 'yellow' | 'orange' | 'blue';
  language: string;
}

export interface AuthUserConsents {
  privacyPolicy: boolean;
  privacyPolicyAcceptedAt?: Date;
  dataSharing: boolean;
  dataSharingAcceptedAt?: Date;
}

export type AuthUserStatus = 'active' | 'inactive' | 'suspended';

export type AuthUserRegistrationApproval = 'pending' | 'approved' | 'rejected';

export interface AuthUser {
  _id: string;
  id: string;
  email: string;
  profile: AuthUserProfile;
  appearance: AuthUserAppearance;
  consents: AuthUserConsents;
  status: AuthUserStatus;
  registrationApproval?: AuthUserRegistrationApproval;
  planId?: string;
  planSlug?: string;
  planStartedAt?: Date;
  roles: string[];
  /** Claimed from the JWT; used by PermissionsGuard without a DB lookup. */
  permissions: string[];
  roleNames: string[];
  permissionsVersion: number;
  emailVerified: boolean;
  profileComplete: boolean;
  createdAt: Date;
}

/**
 * View a still-hydrated Mongo user document as its AuthUser shape. Exists only
 * until identity moves to PostgreSQL (step 1A), which replaces the Mongo
 * document with the plain object described above; `permissions`/`roleNames`
 * are JWT claims that JwtStrategy attaches at runtime.
 */
export const asAuthUser = (user: unknown): AuthUser => user as AuthUser;
