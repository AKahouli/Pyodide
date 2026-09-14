import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Request } from 'express';
import { Project, ProjectDocument } from '../schemas/project.schema';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UserDocument } from '../../user/schemas/user.schema';

interface RequestWithProject extends Request {
  user?: UserDocument;
  project?: ProjectDocument;
}

/**
 * Guard that verifies the authenticated user owns the project being accessed.
 * Expects the project ID in params as 'id'.
 */
@Injectable()
export class ProjectOwnerGuard implements CanActivate {
  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
  ) {}

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
    if (!Types.ObjectId.isValid(projectId)) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Invalid project ID format');
    }

    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Project not found');
    }
    if (project.createdBy.toString() !== user._id.toString()) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN, 'You do not have access to this project');
    }

    request.project = project;
    return true;
  }
}
