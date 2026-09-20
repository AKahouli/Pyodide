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
