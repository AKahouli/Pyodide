import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { Request } from 'express';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import type { AuthUser } from '@common/auth/auth-user';
import type { WorkspaceRecord } from '../ports/workspace-records';
import { PgWorkspaceStore } from '../stores/postgres/pg-workspace-store';
import { PgShareStore } from '../stores/postgres/pg-share-store';

interface RequestWithWorkspace extends Request {
  user?: AuthUser;
  workspace?: WorkspaceRecord;
  workspaceRole?: 'owner' | 'read' | 'readwrite';
}

/**
 * Guard that verifies authenticated user has access to workspace.
 * Access is granted if user is the owner OR has been granted share access.
 *
 * Attaches workspace record and user role to request:
 * - request.workspace: WorkspaceRecord
 * - request.workspaceRole: 'owner' | 'read' | 'readwrite'
 *
 * Expects workspaceId to be in params as either 'id' or 'workspaceId'
 */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(
    private readonly workspaceStore: PgWorkspaceStore,
    private readonly shareStore: PgShareStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithWorkspace>();
    const user = request.user;

    if (!user) {
      return true;
    }

    const rawWorkspaceId = request.params.id || request.params.workspaceId;

    if (!rawWorkspaceId) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace ID is required');
    }

    const workspaceId = rawWorkspaceId.toLowerCase();
    if (!isObjectId(workspaceId)) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Invalid workspace ID format');
    }

    const workspace = await this.workspaceStore.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    }

    const userId = user._id.toString();

    if (workspace.createdBy === userId) {
      request.workspace = workspace;
      request.workspaceRole = 'owner';
      return true;
    }

    // Public workspaces are readable by any authenticated user. This takes
    // precedence over shares: while public, an explicit share is dormant and
    // everyone (even a readwrite-shared user) gets read-only access.
    if (workspace.isPublic) {
      request.workspace = workspace;
      request.workspaceRole = 'read';
      return true;
    }

    const share = await this.shareStore.findOneByWorkspaceAndUser(workspaceId, userId);

    if (!share) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this workspace',
      );
    }

    request.workspace = workspace;
    request.workspaceRole = share.permission;

    return true;
  }
}
