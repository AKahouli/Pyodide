import { Inject, Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Types } from 'mongoose';
import { Request } from 'express';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UserDocument } from '../../user/schemas/user.schema';
import type { WorkspaceRecord } from '../ports/workspace-records';
import { WORKSPACE_STORE, type WorkspaceStore } from '../stores/workspace-store';
import { SHARE_STORE, type ShareStore } from '../stores/share-store';

interface RequestWithWorkspace extends Request {
  user?: UserDocument;
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
    @Inject(WORKSPACE_STORE) private readonly workspaceStore: WorkspaceStore,
    @Inject(SHARE_STORE) private readonly shareStore: ShareStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithWorkspace>();
    const user = request.user;

    if (!user) {
      return true;
    }

    const workspaceId = request.params.id || request.params.workspaceId;

    if (!workspaceId) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace ID is required');
    }

    if (!Types.ObjectId.isValid(workspaceId)) {
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
