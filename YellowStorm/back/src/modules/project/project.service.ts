import { Inject, Injectable } from '@nestjs/common';
import {
  CONVERSATION_STORE,
  type ConversationStore,
} from '../conversation/persistence/conversation-store';
import { PROJECT_STORE, type ProjectRecord, type ProjectStore } from './persistence/project-store';
import { ProjectShareService } from './project-share.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { QueryProjectDto } from './dto/query-project.dto';
import { IProjectResponse } from './interfaces/project.interface';
import { LoggerService } from '../logger';
import { NotFoundException, ConflictException, ForbiddenException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';

@Injectable()
export class ProjectService {
  constructor(
    @Inject(PROJECT_STORE)
    private readonly projectStore: ProjectStore,
    @Inject(CONVERSATION_STORE)
    private readonly conversationStore: ConversationStore,
    private readonly projectShareService: ProjectShareService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ProjectService.name);
  }

  async create(userId: string, dto: CreateProjectDto): Promise<IProjectResponse> {
    const name = dto.name.trim();
    const existing = await this.projectStore.findOne({ name, createdBy: userId });
    if (existing) {
      throw new ConflictException(ErrorCode.PROJECT_ALREADY_EXISTS);
    }

    const project = await this.projectStore.create({ name, createdBy: userId });

    this.logger.log('Project created', { projectId: project.id, userId });

    return this.toResponse(project, 0);
  }

  async findAllByUser(userId: string, query: QueryProjectDto): Promise<IProjectResponse[]> {
    const projects = await this.projectStore.findByOwner(userId, query.search);
    if (projects.length === 0) return [];

    const countMap = await this.conversationStore.countByProjects(projects.map((project) => project.id));

    return projects.map((p) => this.toResponse(p, countMap.get(p.id) ?? 0));
  }

  async findById(userId: string, projectId: string): Promise<IProjectResponse> {
    const project = await this.projectStore.findById(projectId);
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }
    const isOwner = project.createdBy === userId;
    if (!isOwner && !(await this.projectShareService.hasAccess(userId, projectId))) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN);
    }

    // Projects are shared containers: the count includes collaborators' conversations.
    const count = await this.conversationStore.countByProject(projectId);

    return this.toResponse(project, count);
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto): Promise<IProjectResponse> {
    const project = await this.projectStore.findById(projectId);
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }
    if (project.createdBy !== userId) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN);
    }

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name !== project.name) {
        const duplicate = await this.projectStore.findOne({ name, createdBy: userId, excludeId: projectId });
        if (duplicate) {
          throw new ConflictException(ErrorCode.PROJECT_ALREADY_EXISTS);
        }
      }
    }

    const updated = await this.projectStore.updateById(projectId, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
    });
    if (!updated) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }

    const count = await this.conversationStore.countByProject(projectId);

    return this.toResponse(updated, count);
  }

  /**
   * Toggle a project's public visibility. Owner-only (we re-check defensively).
   * Shares are left untouched — while public they are dormant, and reactivate
   * when the project goes back to private.
   */
  async setVisibility(projectId: string, ownerId: string, isPublic: boolean): Promise<IProjectResponse> {
    const project = await this.projectStore.findById(projectId);
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }
    if (project.createdBy !== ownerId) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN);
    }

    const updated = await this.projectStore.updateById(projectId, { isPublic });
    if (!updated) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }
    this.logger.log('Project visibility updated', { projectId, ownerId, isPublic });

    const count = await this.conversationStore.countByProject(projectId);
    return this.toResponse(updated, count);
  }

  async delete(userId: string, projectId: string): Promise<void> {
    const project = await this.projectStore.findById(projectId);
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }
    if (project.createdBy !== userId) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN);
    }

    // Detach every conversation (owner's and collaborators') and drop shares.
    const conversationsDetached = await this.conversationStore.detachProject(projectId);
    await this.projectShareService.removeAllByProject(projectId);

    await this.projectStore.deleteById(projectId);

    this.logger.log('Project deleted', {
      projectId,
      userId,
      conversationsDetached,
    });
  }

  private toResponse(project: ProjectRecord, conversationCount: number): IProjectResponse {
    return {
      id: project.id,
      name: project.name,
      createdBy: project.createdBy,
      conversationCount,
      isPublic: project.isPublic,
      shareCount: project.shareCount,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
