import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
} from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { Request } from 'express';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UserDocument } from '../../user/schemas/user.schema';
import type { WorkspaceRecord } from '../ports/workspace-records';
import { WORKSPACE_STORE, type WorkspaceStore } from '../stores/workspace-store';

interface RequestWithWorkspace extends Request {
  user?: UserDocument;
  workspace?: WorkspaceRecord;
}

/**
 * Guard that verifies the authenticated user owns the workspace being accessed.
 * Attaches the workspace record to request for use in controllers.
 *
 * Expects workspaceId to be in params as either 'id' or 'workspaceId'
 */
@Injectable()
export class WorkspaceOwnerGuard implements CanActivate {
  constructor(
    @Inject(WORKSPACE_STORE)
    private readonly workspaceStore: WorkspaceStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithWorkspace>();
    const user = request.user;

    // Let auth guard handle missing user
    if (!user) {
      return true;
    }

    // Get workspace ID from params (support both 'id' and 'workspaceId')
    const rawWorkspaceId = request.params.id || request.params.workspaceId;

    if (!rawWorkspaceId) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace ID is required',
      );
    }

    // Validate ObjectId format
    const workspaceId = rawWorkspaceId.toLowerCase();
    if (!isObjectId(workspaceId)) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Invalid workspace ID format',
      );
    }

    // Find workspace
    const workspace = await this.workspaceStore.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    // Check ownership
    if (workspace.createdBy !== user._id.toString()) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this workspace',
      );
    }

    // Attach workspace to request for use in controllers
    request.workspace = workspace;

    return true;
  }
}
