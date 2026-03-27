import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
  PermissionsMode,
} from '../decorators/require-permissions.decorator';
import { hasAllPermissions, hasAnyPermission } from '../constants/permissions';
import { ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

/**
 * Guard that checks if the user has required permissions.
 *
 * Uses permissions from JWT (attached to user by JwtStrategy) - no DB lookup required.
 *
 * Can be applied at controller or method level via @RequirePermissions decorator.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required permissions from decorator (check method first, then class)
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no permissions required, allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    // Get mode from decorator (default: 'all')
    const mode =
      this.reflector.getAllAndOverride<PermissionsMode>(PERMISSIONS_MODE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || 'all';

    // Get user from request (attached by JwtStrategy)
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException(ErrorCode.PERMISSION_DENIED);
    }

    // Get permissions from user (attached from JWT by JwtStrategy)
    const userPermissions: string[] = (user as Record<string, unknown>).permissions as string[] || [];

    // Check permissions based on mode
    const hasPermission =
      mode === 'any'
        ? hasAnyPermission(userPermissions, requiredPermissions)
        : hasAllPermissions(userPermissions, requiredPermissions);

    if (!hasPermission) {
      throw new ForbiddenException(ErrorCode.PERMISSION_DENIED);
    }

    return true;
  }
}
