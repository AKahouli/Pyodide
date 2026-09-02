import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { UserStatus } from '../schemas/user.schema';

export interface AccountAccessDenial {
  code: ErrorCode;
  message: string;
}

export function getAccountAccessDenial(status: string): AccountAccessDenial | null {
  if (status === UserStatus.SUSPENDED) {
    return {
      code: ErrorCode.AUTH_ACCOUNT_SUSPENDED,
      message: 'Account is suspended',
    };
  }
  if (status === UserStatus.INACTIVE) {
    return {
      code: ErrorCode.USER_INACTIVE,
      message: 'This account is inactive pending approval.',
    };
  }
  return null;
}

export function assertAccountAccessible(user: { status: string }): void {
  const denial = getAccountAccessDenial(user.status);
  if (denial) {
    throw new ForbiddenException(denial.code, denial.message);
  }
}
