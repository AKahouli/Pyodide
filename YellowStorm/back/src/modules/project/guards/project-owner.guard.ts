import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { type ProjectRecord } from '../persistence/project-store';
import { PostgresProjectStore } from '../persistence/postgres/postgres-project-store';
import { isObjectId, normalizeObjectId } from '@common/postgres/object-id';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import type { AuthUser } from '@common/auth/auth-user';

interface RequestWithProject extends Request {
  user?: AuthUser;
  project?: ProjectRecord;
}

/**
 * Guard that verifies the authenticated user owns the project being accessed.
 * Expects the project ID in params as 'id'.
 */
@Injectable()
export class ProjectOwnerGuard implements CanActivate {
  constructor(private readonly projectStore: PostgresProjectStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithProject>();
    const user = request.user;

    // Let auth guard handle missing user
    if (!user) {
      return true;
    }

    const projectId = request.params.id;
    if (!projectId) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Project ID is required');
    }
    if (!isObjectId(projectId)) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Invalid project ID format');
    }

    const project = await this.projectStore.findById(normalizeObjectId(projectId));
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Project not found');
    }
    if (project.createdBy !== user._id.toString()) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN, 'You do not have access to this project');
    }

    request.project = project;
    return true;
  }
}
