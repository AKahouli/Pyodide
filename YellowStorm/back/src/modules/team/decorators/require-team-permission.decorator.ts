import { SetMetadata } from '@nestjs/common';

export const TEAM_PERMISSION_KEY = 'teamPermission';

/**
 * Required permission level for a team endpoint.
 *
 * - `'read'`  — Owner + any shared user (read or write)
 * - `'write'` — Owner + write-shared users only
 * - `'owner'` — Owner only (e.g. delete, manage shares)
 *
 * @example
 * @UseGuards(TeamPermissionGuard)
 * @RequireTeamPermission('owner')
 * @Post(':id/shares')
 * async share(...) { ... }
 */
export type RequiredTeamPermission = 'read' | 'write' | 'owner';

export const RequireTeamPermission = (permission: RequiredTeamPermission) =>
  SetMetadata(TEAM_PERMISSION_KEY, permission);
