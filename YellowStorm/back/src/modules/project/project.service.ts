import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import {
  CONVERSATION_STORE,
  type ConversationStore,
} from '../conversation/persistence/conversation-store';
import { ProjectShareService } from './project-share.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { QueryProjectDto } from './dto/query-project.dto';
import { IProjectResponse } from './interfaces/project.interface';
import { LoggerService } from '../logger';
import { NotFoundException, ConflictException, ForbiddenException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { escapeRegex } from '../../common/utils';

@Injectable()
export class ProjectService {
  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @Inject(CONVERSATION_STORE)
    private readonly conversationStore: ConversationStore,
    private readonly projectShareService: ProjectShareService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ProjectService.name);
  }

  async create(userId: string, dto: CreateProjectDto): Promise<IProjectResponse> {
    const name = dto.name.trim();
    const existing = await this.projectModel
      .findOne({ name, createdBy: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (existing) {
      throw new ConflictException(ErrorCode.PROJECT_ALREADY_EXISTS);
    }

    const project = await this.projectModel.create({
      name,
      createdBy: new Types.ObjectId(userId),
    });

    this.logger.log('Project created', { projectId: project._id.toString(), userId });

    return this.toResponse(project, 0);
  }

  async findAllByUser(userId: string, query: QueryProjectDto): Promise<IProjectResponse[]> {
    const filter: FilterQuery<ProjectDocument> = {
      createdBy: new Types.ObjectId(userId),
    };

    if (query.search) {
      filter.name = { $regex: escapeRegex(query.search), $options: 'i' };
    }

    const projects = await this.projectModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    if (projects.length === 0) return [];

    const countMap = await this.conversationStore.countByProjects(
      projects.map((project) => project._id.toString()),
    );

    return projects.map((p) => this.toResponse(p, countMap.get(p._id.toString()) || 0));
  }

  async findById(userId: string, projectId: string): Promise<IProjectResponse> {
    const project = await this.projectModel.findById(projectId).lean().exec();
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }
    const isOwner = project.createdBy.toString() === userId;
    if (!isOwner && !(await this.projectShareService.hasAccess(userId, projectId))) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN);
    }

    // Projects are shared containers: the count includes collaborators' conversations.
    const count = await this.conversationStore.countByProject(projectId);

    return this.toResponse(project, count);
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto): Promise<IProjectResponse> {
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }
    if (project.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN);
    }

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name !== project.name) {
        const duplicate = await this.projectModel
          .findOne({ name, createdBy: new Types.ObjectId(userId), _id: { $ne: project._id } })
          .lean()
          .exec();
        if (duplicate) {
          throw new ConflictException(ErrorCode.PROJECT_ALREADY_EXISTS);
        }
        project.name = name;
      }
    }

    await project.save();

    const count = await this.conversationStore.countByProject(projectId);

    return this.toResponse(project, count);
  }

  /**
   * Toggle a project's public visibility. Owner-only (we re-check defensively).
   * Shares are left untouched — while public they are dormant, and reactivate
   * when the project goes back to private.
   */
  async setVisibility(projectId: string, ownerId: string, isPublic: boolean): Promise<IProjectResponse> {
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }
    if (project.createdBy.toString() !== ownerId) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN);
    }

    project.isPublic = isPublic;
    await project.save();
    this.logger.log('Project visibility updated', { projectId, ownerId, isPublic });

    const count = await this.conversationStore.countByProject(projectId);
    return this.toResponse(project, count);
  }

  async delete(userId: string, projectId: string): Promise<void> {
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }
    if (project.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN);
    }

    // Detach every conversation (owner's and collaborators') and drop shares.
    const conversationsDetached = await this.conversationStore.detachProject(projectId);
    await this.projectShareService.removeAllByProject(projectId);

    await this.projectModel.deleteOne({ _id: project._id });

    this.logger.log('Project deleted', {
      projectId,
      userId,
      conversationsDetached,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any, conversationCount: number): IProjectResponse {
    return {
      id: (doc._id as { toString(): string }).toString(),
      name: doc.name as string,
      createdBy: (doc.createdBy as { toString(): string }).toString(),
      conversationCount,
      isPublic: Boolean(doc.isPublic),
      shareCount: Number(doc.shareCount ?? 0),
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    };
  }
}
