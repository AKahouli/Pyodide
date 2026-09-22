import { AuthUser } from '@common/auth/auth-user';
import { UserRecord, UserSearchHit } from './user.store';

/**
 * Builds the wire shape of a user — byte-compatible with the Mongo schema's
 * toJSON (virtuals `id` + `fullName`, transform stripping `_id`/`__v`/
 * passwordHash/one-time tokens), gated by test/contracts/user fixtures.
 * Optional unset columns are omitted (Mongo `minimize` parity): never emit
 * nulls for them.
 */
export function toUserWire(record: UserRecord): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    id: record.id,
    email: record.email,
    emailVerified: record.emailVerified,
    profile: {
      ...(record.firstName !== null && { firstName: record.firstName }),
      ...(record.lastName !== null && { lastName: record.lastName }),
      ...(record.company !== null && { company: record.company }),
      role: record.profileRole,
      description: record.description,
    },
    appearance: { colorTheme: record.colorTheme, language: record.language },
    consents: {
      privacyPolicy: record.consentPrivacyPolicy,
      ...(record.consentPrivacyPolicyAcceptedAt !== null && { privacyPolicyAcceptedAt: record.consentPrivacyPolicyAcceptedAt }),
      dataSharing: record.consentDataSharing,
      ...(record.consentDataSharingAcceptedAt !== null && { dataSharingAcceptedAt: record.consentDataSharingAcceptedAt }),
    },
    profileComplete: record.profileComplete,
    roles: record.roleIds,
    permissionsVersion: record.permissionsVersion,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  if (record.emailVerificationExpiry !== null) wire.emailVerificationExpiry = record.emailVerificationExpiry;
  if (record.passwordResetExpiry !== null) wire.passwordResetExpiry = record.passwordResetExpiry;
  if (record.microsoftAccountId !== null) wire.microsoftAccountId = record.microsoftAccountId;
  if (record.planId !== null) wire.planId = record.planId;
  if (record.planSlug !== null) wire.planSlug = record.planSlug;
  if (record.planStartedAt !== null) wire.planStartedAt = record.planStartedAt;
  if (record.registrationApproval !== null) wire.registrationApproval = record.registrationApproval;
  if (record.lastLoginAt !== null) wire.lastLoginAt = record.lastLoginAt;
  const fullName = fullNameOf(record);
  if (fullName !== undefined) wire.fullName = fullName;
  return wire;
}

/** The schema's `fullName` virtual: 'First Last' when both exist, else whichever exists. */
export function fullNameOf(record: Pick<UserRecord, 'firstName' | 'lastName'>): string | undefined {
  if (record.firstName && record.lastName) return `${record.firstName} ${record.lastName}`;
  return record.firstName || record.lastName || undefined;
}

/** The plain object JwtStrategy.validate returns per request (step 0.5). */
export function toAuthUser(
  record: UserRecord,
  claims: { permissions: string[]; roleNames: string[]; permissionsVersion?: number },
): AuthUser {
  return {
    _id: record.id,
    id: record.id,
    email: record.email,
    profile: {
      firstName: record.firstName ?? undefined,
      lastName: record.lastName ?? undefined,
      company: record.company ?? undefined,
      role: record.profileRole,
      description: record.description,
    },
    appearance: { colorTheme: record.colorTheme, language: record.language },
    consents: {
      privacyPolicy: record.consentPrivacyPolicy,
      privacyPolicyAcceptedAt: record.consentPrivacyPolicyAcceptedAt ?? undefined,
      dataSharing: record.consentDataSharing,
      dataSharingAcceptedAt: record.consentDataSharingAcceptedAt ?? undefined,
    },
    status: record.status,
    registrationApproval: record.registrationApproval ?? undefined,
    planId: record.planId ?? undefined,
    planSlug: record.planSlug ?? undefined,
    planStartedAt: record.planStartedAt ?? undefined,
    roles: record.roleIds,
    permissions: claims.permissions,
    roleNames: claims.roleNames,
    permissionsVersion: claims.permissionsVersion ?? record.permissionsVersion,
    emailVerified: record.emailVerified,
    profileComplete: record.profileComplete,
    createdAt: record.createdAt,
  };
}

export function toSummary(record: UserRecord): { id: string; email: string; firstName: string; lastName: string } {
  return {
    id: record.id,
    email: record.email,
    firstName: record.firstName ?? '',
    lastName: record.lastName ?? '',
  };
}

export function toSearchHit(record: Pick<UserRecord, 'id' | 'email' | 'firstName' | 'lastName'>): UserSearchHit {
  return { id: record.id, email: record.email, firstName: record.firstName, lastName: record.lastName };
}

/**
 * Plain object with the same FIELD LAYOUT as a hydrated Mongo user document
 * (nested profile/appearance/consents, `_id`/`id` strings) — what internal
 * consumers (auth, jwt, shares, channels) read today. Unlike toUserWire this
 * INCLUDES secrets (passwordHash, one-time tokens); it must never be returned
 * from a controller.
 */
export interface UserDocLike {
  _id: string;
  id: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationExpiry?: Date;
  passwordResetToken?: string;
  passwordResetExpiry?: Date;
  profile: {
    firstName?: string;
    lastName?: string;
    company?: string;
    role: string;
    description: string;
  };
  appearance: { colorTheme: UserRecord['colorTheme']; language: string };
  consents: {
    privacyPolicy: boolean;
    privacyPolicyAcceptedAt?: Date;
    dataSharing: boolean;
    dataSharingAcceptedAt?: Date;
  };
  profileComplete: boolean;
  microsoftAccountId?: string;
  planId?: string;
  planSlug?: string;
  planStartedAt?: Date;
  roles: string[];
  permissionsVersion: number;
  status: UserRecord['status'];
  registrationApproval?: UserRecord['registrationApproval'];
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function toUserDoc(record: UserRecord): UserDocLike {
  return {
    _id: record.id,
    id: record.id,
    email: record.email,
    passwordHash: record.passwordHash,
    emailVerified: record.emailVerified,
    ...(record.emailVerificationToken !== null && { emailVerificationToken: record.emailVerificationToken }),
    ...(record.emailVerificationExpiry !== null && { emailVerificationExpiry: record.emailVerificationExpiry }),
    ...(record.passwordResetToken !== null && { passwordResetToken: record.passwordResetToken }),
    ...(record.passwordResetExpiry !== null && { passwordResetExpiry: record.passwordResetExpiry }),
    profile: {
      ...(record.firstName !== null && { firstName: record.firstName }),
      ...(record.lastName !== null && { lastName: record.lastName }),
      ...(record.company !== null && { company: record.company }),
      role: record.profileRole,
      description: record.description,
    },
    appearance: { colorTheme: record.colorTheme, language: record.language },
    consents: {
      privacyPolicy: record.consentPrivacyPolicy,
      ...(record.consentPrivacyPolicyAcceptedAt !== null && { privacyPolicyAcceptedAt: record.consentPrivacyPolicyAcceptedAt }),
      dataSharing: record.consentDataSharing,
      ...(record.consentDataSharingAcceptedAt !== null && { dataSharingAcceptedAt: record.consentDataSharingAcceptedAt }),
    },
    profileComplete: record.profileComplete,
    ...(record.microsoftAccountId !== null && { microsoftAccountId: record.microsoftAccountId }),
    ...(record.planId !== null && { planId: record.planId }),
    ...(record.planSlug !== null && { planSlug: record.planSlug }),
    ...(record.planStartedAt !== null && { planStartedAt: record.planStartedAt }),
    roles: record.roleIds,
    permissionsVersion: record.permissionsVersion,
    status: record.status,
    ...(record.registrationApproval !== null && { registrationApproval: record.registrationApproval }),
    ...(record.lastLoginAt !== null && { lastLoginAt: record.lastLoginAt }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
