import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { UserStatus } from '../user.types';
import { getFeatureAccessDenial } from '../utils/assert-account-accessible';

export function isPendingApprovalAllowlistedPath(path: string): boolean {
  const normalized = path.split('?')[0].replace(/^\/api\/v\d+(?=\/|$)/, '');
  return /^\/auth(?:\/|$)/.test(normalized) || /^\/users\/me(?:\/|$)/.test(normalized);
}

/**
 * After JWT auth: inactive users may keep a session and complete their profile,
 * but cannot call the rest of the API until Super Admin approval.
 */
@Injectable()
export class AccountApprovalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      path?: string;
      originalUrl?: string;
      user?: { status?: string };
    }>();

    if (request.method === 'OPTIONS') {
      return true;
    }

    const status = request.user?.status;
    if (status !== UserStatus.INACTIVE) {
      return true;
    }

    const path = request.path || request.originalUrl || '';
    if (isPendingApprovalAllowlistedPath(path)) {
      return true;
    }

    const denial = getFeatureAccessDenial(UserStatus.INACTIVE);
    throw new ForbiddenException(
      denial?.code ?? ErrorCode.USER_INACTIVE,
      denial?.message,
    );
  }
}
