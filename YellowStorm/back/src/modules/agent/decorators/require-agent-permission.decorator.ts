import { SetMetadata } from '@nestjs/common';

export const AGENT_PERMISSION_KEY = 'agentPermission';

/**
 * Required permission level for an agent endpoint.
 *
 * - `'read'`  — Owner + any shared user (read or write)
 * - `'write'` — Owner + write-shared users only
 * - `'owner'` — Owner only (e.g. manage shares)
 *
 * @example
 * @UseGuards(AgentPermissionGuard)
 * @RequireAgentPermission('owner')
 * @Post(':id/shares')
 * async share(...) { ... }
 */
export type RequiredAgentPermission = 'read' | 'write' | 'owner';

export const RequireAgentPermission = (permission: RequiredAgentPermission) =>
  SetMetadata(AGENT_PERMISSION_KEY, permission);
