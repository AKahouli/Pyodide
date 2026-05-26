import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Workspace,
  WorkspaceDocument,
} from '../../workspace/schemas/workspace.schema';
import {
  WorkspaceShare,
  WorkspaceShareDocument,
} from '../../workspace/schemas/workspace-share.schema';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

/**
 * Centralized workspace-access check for the classifier module.
 * Grants access to the workspace owner or to any user with an active share.
 */
@Injectable()
export class ClassifierAccessService {
  constructor(
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(WorkspaceShare.name)
    private readonly shareModel: Model<WorkspaceShareDocument>,
  ) {}

  async assertWorkspaceAccess(workspaceId: string, userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(workspaceId)) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND);
    }

    const workspace = await this.workspaceModel
      .findById(workspaceId)
      .select({ _id: 1, createdBy: 1 })
      .lean()
      .exec();

    if (!workspace) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND);
    }

    if (workspace.createdBy.toString() === userId) {
      return;
    }

    const share = await this.shareModel
      .findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        sharedWithUserId: new Types.ObjectId(userId),
      })
      .select({ _id: 1 })
      .lean()
      .exec();

    if (!share) {
      throw new ForbiddenException(ErrorCode.WORKSPACE_FORBIDDEN);
    }
  }
}
