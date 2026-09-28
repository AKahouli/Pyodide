import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { PgWorkspaceReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-read.adapter';
import { PgWorkspaceShareReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-share-read.adapter';

/**
 * Centralized workspace-access check for the classifier module.
 * Grants access to the workspace owner or to any user with an active share.
 */
@Injectable()
export class ClassifierAccessService {
  constructor(
    private readonly workspaceReadPort: PgWorkspaceReadAdapter,
    private readonly shareReadPort: PgWorkspaceShareReadAdapter,
  ) {}

  async assertWorkspaceAccess(workspaceId: string, userId: string): Promise<void> {
    if (!isObjectId(workspaceId)) {
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
