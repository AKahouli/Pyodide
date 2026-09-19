import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  WORKSPACE_READ_PORT,
  WORKSPACE_SHARE_READ_PORT,
  type WorkspaceReadPort,
  type WorkspaceShareReadPort,
} from '../../workspace/ports';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

/**
 * Centralized workspace-access check for the classifier module.
 * Grants access to the workspace owner or to any user with an active share.
 */
@Injectable()
export class ClassifierAccessService {
  constructor(
    @Inject(WORKSPACE_READ_PORT) private readonly workspaceReadPort: WorkspaceReadPort,
    @Inject(WORKSPACE_SHARE_READ_PORT) private readonly shareReadPort: WorkspaceShareReadPort,
  ) {}

  async assertWorkspaceAccess(workspaceId: string, userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(workspaceId)) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND);
    }

    const workspace = await this.workspaceReadPort.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND);
    }

    if (workspace.createdBy === userId) {
      return;
    }

    const permission = await this.shareReadPort.permissionFor(workspaceId, userId);

    if (!permission) {
      throw new ForbiddenException(ErrorCode.WORKSPACE_FORBIDDEN);
    }
  }
}
