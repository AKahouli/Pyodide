import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import { Conversation, ConversationDocument } from '../conversation/schemas/conversation.schema';
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
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
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

    const counts = await this.conversationModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      {
        $match: {
          projectId: { $in: projects.map((p) => p._id) },
          createdBy: new Types.ObjectId(userId),
        },
      },
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]);

    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

    return projects.map((p) => this.toResponse(p, countMap.get(p._id.toString()) || 0));
  }

  async findById(userId: string, projectId: string): Promise<IProjectResponse> {
    const project = await this.projectModel.findById(projectId).lean().exec();
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND);
    }
    if (project.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN);
    }

    const count = await this.conversationModel.countDocuments({
      projectId: new Types.ObjectId(projectId),
      createdBy: new Types.ObjectId(userId),
    });

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

    const count = await this.conversationModel.countDocuments({
      projectId: new Types.ObjectId(projectId),
      createdBy: new Types.ObjectId(userId),
    });

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

    // Detach all conversations so they return to the user's history.
    const detached = await this.conversationModel.updateMany(
      { projectId: new Types.ObjectId(projectId), createdBy: new Types.ObjectId(userId) },
      { $unset: { projectId: '' } },
    );

    await this.projectModel.deleteOne({ _id: project._id });

    this.logger.log('Project deleted', {
      projectId,
      userId,
      conversationsDetached: detached.modifiedCount,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any, conversationCount: number): IProjectResponse {
    return {
      id: (doc._id as { toString(): string }).toString(),
      name: doc.name as string,
      createdBy: (doc.createdBy as { toString(): string }).toString(),
      conversationCount,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    };
  }
}
