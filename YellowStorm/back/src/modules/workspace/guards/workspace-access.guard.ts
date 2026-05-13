import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Request } from 'express';
import { Workspace, WorkspaceDocument } from '../schemas/workspace.schema';
import { WorkspaceShare, WorkspaceShareDocument } from '../schemas/workspace-share.schema';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UserDocument } from '../../user/schemas/user.schema';

interface RequestWithWorkspace extends Request {
  user?: UserDocument;
  workspace?: WorkspaceDocument;
  workspaceRole?: 'owner' | 'read' | 'readwrite';
}

/**
 * Guard that verifies authenticated user has access to workspace.
 * Access is granted if user is the owner OR has been granted share access.
 *
 * Attaches workspace document and user role to request:
 * - request.workspace: WorkspaceDocument
 * - request.workspaceRole: 'owner' | 'read' | 'readwrite'
 *
 * Expects workspaceId to be in params as either 'id' or 'workspaceId'
 */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(WorkspaceShare.name)
    private readonly shareModel: Model<WorkspaceShareDocument>,
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

    const workspace = await this.workspaceModel.findById(workspaceId).exec();

    if (!workspace) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    }

    const userId = user._id.toString();

    if (workspace.createdBy.toString() === userId) {
      request.workspace = workspace;
      request.workspaceRole = 'owner';
      return true;
    }

    const share = await this.shareModel
      .findOne({ workspaceId: new Types.ObjectId(workspaceId), sharedWithUserId: user._id })
      .lean()
      .exec();

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
