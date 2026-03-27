import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Request } from 'express';
import { Workspace, WorkspaceDocument } from '../schemas/workspace.schema';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UserDocument } from '../../user/schemas/user.schema';

interface RequestWithWorkspace extends Request {
  user?: UserDocument;
  workspace?: WorkspaceDocument;
}

/**
 * Guard that verifies the authenticated user owns the workspace being accessed.
 * Attaches the workspace document to request for use in controllers.
 *
 * Expects workspaceId to be in params as either 'id' or 'workspaceId'
 */
@Injectable()
export class WorkspaceOwnerGuard implements CanActivate {
  constructor(
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithWorkspace>();
    const user = request.user;

    // Let auth guard handle missing user
    if (!user) {
      return true;
    }

    // Get workspace ID from params (support both 'id' and 'workspaceId')
    const workspaceId = request.params.id || request.params.workspaceId;

    if (!workspaceId) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace ID is required',
      );
    }

    // Validate ObjectId format
    if (!Types.ObjectId.isValid(workspaceId)) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Invalid workspace ID format',
      );
    }

    // Find workspace
    const workspace = await this.workspaceModel.findById(workspaceId).exec();

    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    // Check ownership
    if (workspace.createdBy.toString() !== user._id.toString()) {
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
