import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { UserStatus } from '../schemas/user.schema';
import {
  assertAccountAccessible,
  getAccountAccessDenial,
} from './assert-account-accessible';

describe('assertAccountAccessible', () => {
  it('allows active accounts', () => {
    expect(getAccountAccessDenial(UserStatus.ACTIVE)).toBeNull();
    expect(() => assertAccountAccessible({ status: UserStatus.ACTIVE })).not.toThrow();
  });

  it('denies suspended accounts with AUTH_ACCOUNT_SUSPENDED', () => {
    expect(getAccountAccessDenial(UserStatus.SUSPENDED)).toEqual({
      code: ErrorCode.AUTH_ACCOUNT_SUSPENDED,
      message: 'Account is suspended',
    });
    expect(() => assertAccountAccessible({ status: UserStatus.SUSPENDED })).toThrow(
      ForbiddenException,
    );
  });

  it('denies inactive accounts with USER_INACTIVE', () => {
    expect(getAccountAccessDenial(UserStatus.INACTIVE)).toEqual({
      code: ErrorCode.USER_INACTIVE,
      message: 'This account is inactive pending approval.',
    });
    try {
      assertAccountAccessible({ status: UserStatus.INACTIVE });
      throw new Error('expected ForbiddenException');
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.USER_INACTIVE });
    }
  });
});
