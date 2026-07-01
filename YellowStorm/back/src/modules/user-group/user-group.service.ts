import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserGroup, UserGroupDocument } from './schemas/user-group.schema';
import { CreateUserGroupDto, UpdateUserGroupDto } from './dto';
import { IUserGroupMember, IUserGroupResponse } from './interfaces/user-group.interface';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { LoggerService } from '../logger';

const MEMBER_POPULATE = { path: 'members', select: 'email profile.firstName profile.lastName' };

/**
 * User groups are private, user-owned lists of registered users. They exist to
 * make sharing faster: expanding a group yields member emails that the existing
 * workspace-share flow consumes. Every operation is scoped to the owner; a
 * non-owner is treated as if the group does not exist.
 */
@Injectable()
export class UserGroupService {
  constructor(
    @InjectModel(UserGroup.name)
    private readonly groupModel: Model<UserGroupDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(UserGroupService.name);
  }

  async create(userId: string, dto: CreateUserGroupDto): Promise<IUserGroupResponse> {
    const owner = new Types.ObjectId(userId);
    const existing = await this.groupModel.findOne({ name: dto.name, createdBy: owner }).lean().exec();
    if (existing) {
      throw new ConflictException(ErrorCode.USER_GROUP_ALREADY_EXISTS);
    }

    const created = await this.groupModel.create({
      name: dto.name,
      description: dto.description ?? '',
      members: this.toMemberObjectIds(dto.memberIds),
      createdBy: owner,
    });

    this.logger.log('User group created', { groupId: created._id.toString(), userId });
    return this.getPopulated(created._id.toString());
  }

  async findAllForUser(userId: string): Promise<IUserGroupResponse[]> {
    const groups = await this.groupModel
      .find({ createdBy: new Types.ObjectId(userId) })
      .populate(MEMBER_POPULATE)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return groups.map((g) => this.toResponse(g as unknown as Record<string, unknown>));
  }

  async findById(userId: string, id: string): Promise<IUserGroupResponse> {
    const group = await this.loadOwnedLean(userId, id);
    return this.toResponse(group);
  }

  async update(userId: string, id: string, dto: UpdateUserGroupDto): Promise<IUserGroupResponse> {
    const group = await this.loadOwnedDoc(userId, id);

    if (dto.name !== undefined && dto.name !== group.name) {
      const clash = await this.groupModel
        .findOne({ name: dto.name, createdBy: group.createdBy, _id: { $ne: group._id } })
        .lean()
        .exec();
      if (clash) {
        throw new ConflictException(ErrorCode.USER_GROUP_ALREADY_EXISTS);
      }
      group.name = dto.name;
    }
    if (dto.description !== undefined) group.description = dto.description;

    await group.save();
    this.logger.log('User group updated', { groupId: id, userId });
    return this.getPopulated(id);
  }

  async delete(userId: string, id: string): Promise<void> {
    const group = await this.loadOwnedDoc(userId, id);
    await this.groupModel.findByIdAndDelete(group._id).exec();
    this.logger.log('User group deleted', { groupId: id, userId });
  }

  async addMembers(userId: string, id: string, userIds: string[]): Promise<IUserGroupResponse> {
    const group = await this.loadOwnedDoc(userId, id);
    const objectIds = this.toMemberObjectIds(userIds);
    if (objectIds.length > 0) {
      await this.groupModel
        .updateOne({ _id: group._id }, { $addToSet: { members: { $each: objectIds } } })
        .exec();
    }
    this.logger.log('User group members added', { groupId: id, userId, count: objectIds.length });
    return this.getPopulated(id);
  }

  async removeMember(userId: string, id: string, memberId: string): Promise<IUserGroupResponse> {
    const group = await this.loadOwnedDoc(userId, id);
    if (Types.ObjectId.isValid(memberId)) {
      await this.groupModel
        .updateOne({ _id: group._id }, { $pull: { members: new Types.ObjectId(memberId) } })
        .exec();
    }
    this.logger.log('User group member removed', { groupId: id, userId, memberId });
    return this.getPopulated(id);
  }

  // ===== Helpers =====

  private toMemberObjectIds(ids?: string[]): Types.ObjectId[] {
    return [...new Set(ids || [])]
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
  }

  /** Load a hydrated doc the user owns (for writes). NotFound if missing OR not owner. */
  private async loadOwnedDoc(userId: string, id: string): Promise<UserGroupDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    const group = await this.groupModel.findById(id).exec();
    if (!group) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    if (group.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    return group;
  }

  /** Load a lean, populated group the user owns (for reads). */
  private async loadOwnedLean(userId: string, id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    const group = await this.groupModel.findById(id).populate(MEMBER_POPULATE).lean().exec();
    if (!group) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    if ((group as unknown as { createdBy: Types.ObjectId }).createdBy.toString() !== userId) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    return group as unknown as Record<string, unknown>;
  }

  private async getPopulated(id: string): Promise<IUserGroupResponse> {
    const group = await this.groupModel.findById(id).populate(MEMBER_POPULATE).lean().exec();
    if (!group) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    return this.toResponse(group as unknown as Record<string, unknown>);
  }

  private toResponse(group: Record<string, unknown>): IUserGroupResponse {
    const rawMembers = (group.members as unknown[]) || [];
    const members: IUserGroupMember[] = rawMembers
      // A ref to a deleted user populates as null — drop it.
      .filter((m): m is Record<string, unknown> => m !== null && typeof m === 'object' && '_id' in m)
      .map((m) => {
        const profile = (m.profile as { firstName?: string; lastName?: string } | undefined) ?? {};
        return {
          id: (m._id as { toString(): string }).toString(),
          email: (m.email as string) ?? '',
          firstName: profile.firstName,
          lastName: profile.lastName,
        };
      });

    return {
      id: (group._id as { toString(): string }).toString(),
      name: group.name as string,
      description: (group.description as string) || '',
      members,
      memberCount: members.length,
      createdAt: group.createdAt as Date,
      updatedAt: group.updatedAt as Date,
    };
  }
}
