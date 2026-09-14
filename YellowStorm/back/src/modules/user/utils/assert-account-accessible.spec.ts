import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { UserStatus } from '../schemas/user.schema';
import {
  assertAccountAccessible,
  assertAccountApproved,
  getAccountAccessDenial,
  getFeatureAccessDenial,
} from './assert-account-accessible';

describe('assertAccountAccessible', () => {
  it('allows active accounts', () => {
    expect(getAccountAccessDenial(UserStatus.ACTIVE)).toBeNull();
    expect(() => assertAccountAccessible({ status: UserStatus.ACTIVE })).not.toThrow();
  });

  it('allows inactive accounts to obtain a session', () => {
    expect(getAccountAccessDenial(UserStatus.INACTIVE)).toBeNull();
    expect(() => assertAccountAccessible({ status: UserStatus.INACTIVE })).not.toThrow();
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
});

describe('assertAccountApproved', () => {
  it('allows active accounts to use features', () => {
    expect(getFeatureAccessDenial(UserStatus.ACTIVE)).toBeNull();
    expect(() => assertAccountApproved({ status: UserStatus.ACTIVE })).not.toThrow();
  });

  it('denies inactive accounts with USER_INACTIVE', () => {
    expect(getFeatureAccessDenial(UserStatus.INACTIVE)).toEqual({
      code: ErrorCode.USER_INACTIVE,
      message: 'This account is inactive pending approval.',
    });
    try {
      assertAccountApproved({ status: UserStatus.INACTIVE });
      throw new Error('expected ForbiddenException');
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.USER_INACTIVE });
    }
  });
});
