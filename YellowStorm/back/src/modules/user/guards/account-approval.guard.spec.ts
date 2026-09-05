import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { UserStatus } from '../schemas/user.schema';
import {
  AccountApprovalGuard,
  isPendingApprovalAllowlistedPath,
} from './account-approval.guard';

describe('isPendingApprovalAllowlistedPath', () => {
  it('allows auth and current-user profile routes', () => {
    expect(isPendingApprovalAllowlistedPath('/api/v1/auth/logout')).toBe(true);
    expect(isPendingApprovalAllowlistedPath('/auth/logout')).toBe(true);
    expect(isPendingApprovalAllowlistedPath('/api/v1/users/me')).toBe(true);
    expect(isPendingApprovalAllowlistedPath('/users/me')).toBe(true);
    expect(isPendingApprovalAllowlistedPath('/api/v1/users/me/complete-profile')).toBe(true);
  });

  it('blocks feature and user-search routes', () => {
    expect(isPendingApprovalAllowlistedPath('/api/v1/users/search')).toBe(false);
    expect(isPendingApprovalAllowlistedPath('/api/v1/conversation')).toBe(false);
    expect(isPendingApprovalAllowlistedPath('/api/v1/admin/users')).toBe(false);
  });
});

describe('AccountApprovalGuard', () => {
  const guard = new AccountApprovalGuard();

  const run = (user: { status: string } | undefined, path: string) => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', path, user }),
      }),
    };
    return guard.canActivate(context as never);
  };

  it('allows requests without a user or with an active user', () => {
    expect(run(undefined, '/api/v1/conversation')).toBe(true);
    expect(run({ status: UserStatus.ACTIVE }, '/api/v1/conversation')).toBe(true);
  });

  it('allows inactive users on profile routes', () => {
    expect(run({ status: UserStatus.INACTIVE }, '/api/v1/users/me')).toBe(true);
  });

  it('blocks inactive users on feature routes', () => {
    try {
      run({ status: UserStatus.INACTIVE }, '/api/v1/conversation');
      throw new Error('expected ForbiddenException');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error).toMatchObject({ code: ErrorCode.USER_INACTIVE });
    }
  });
});