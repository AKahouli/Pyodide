import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@common/auth/auth-user';

/**
 * Decorator to extract the current authenticated user from the request
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;

    if (data) {
      return user?.[data];
    }

    return user;
  },
);
