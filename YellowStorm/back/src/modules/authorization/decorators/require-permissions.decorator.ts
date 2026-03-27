import { SetMetadata, applyDecorators } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const PERMISSIONS_MODE_KEY = 'permissionsMode';

export type PermissionsMode = 'all' | 'any';

/**
 * Decorator to require specific permissions on a route.
 *
 * @example
 * // Single permission
 * @RequirePermissions('users.suspend')
 *
 * @example
 * // Multiple permissions (all required by default)
 * @RequirePermissions('plans.create', 'plans.update')
 *
 * @example
 * // Any of these permissions (OR logic)
 * @RequirePermissions(['analytics.read', 'reports.read'], 'any')
 *
 * @example
 * // Controller-level (applies to all routes)
 * @Controller('experimental/analytics')
 * @RequirePermissions('analytics.read')
 * export class AnalyticsController { }
 */
export function RequirePermissions(
  permissions: string | string[],
  mode: PermissionsMode = 'all',
): MethodDecorator & ClassDecorator {
  const permissionsArray = Array.isArray(permissions) ? permissions : [permissions];
  return applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissionsArray),
    SetMetadata(PERMISSIONS_MODE_KEY, mode),
  );
}
