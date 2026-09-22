import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { UserStatus } from '../user.types';

export interface AccountAccessDenial {
  code: ErrorCode;
  message: string;
}

/** Session-level denial: suspended accounts cannot log in or keep a JWT. */
export function getAccountAccessDenial(status: string): AccountAccessDenial | null {
  if (status === UserStatus.SUSPENDED) {
    return {
      code: ErrorCode.AUTH_ACCOUNT_SUSPENDED,
      message: 'Account is suspended',
    };
  }
  return null;
}

/** Feature-level denial: inactive accounts may session, but cannot use the app. */
export function getFeatureAccessDenial(status: string): AccountAccessDenial | null {
  if (status === UserStatus.INACTIVE) {
    return {
      code: ErrorCode.USER_INACTIVE,
      message: 'This account is inactive pending approval.',
    };
  }
  return getAccountAccessDenial(status);
}

export function assertAccountAccessible(user: { status: string }): void {
  const denial = getAccountAccessDenial(user.status);
  if (denial) {
    throw new ForbiddenException(denial.code, denial.message);
  }
}

export function assertAccountApproved(user: { status: string }): void {
  const denial = getFeatureAccessDenial(user.status);
  if (denial) {
    throw new ForbiddenException(denial.code, denial.message);
  }
}
