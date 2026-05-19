import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

interface RequestWithWorkspaceRole extends Request {
  workspaceRole?: 'owner' | 'read' | 'readwrite';
}

/**
 * Guard that verifies user has write permission on a workspace.
 * Must be used AFTER WorkspaceAccessGuard (which sets workspaceRole on request).
 *
 * Allows: 'owner' and 'readwrite' roles
 * Blocks: 'read' role
 */
@Injectable()
export class WritePermissionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithWorkspaceRole>();
    const role = request.workspaceRole;

    if (!role) {
      throw new ForbiddenException(
        ErrorCode.FORBIDDEN,
        'Workspace role not found. Ensure WorkspaceAccessGuard runs before WritePermissionGuard.',
      );
    }

    if (role === 'read') {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_READ_ONLY,
        'You have read-only access to this workspace',
      );
    }

    return true;
  }
}
