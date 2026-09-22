import { Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { CreateUserGroupDto, UpdateUserGroupDto } from './dto';
import { IUserGroupMember, IUserGroupResponse } from './interfaces/user-group.interface';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { LoggerService } from '../logger';
import { USER_GROUP_STORE, type PopulatedGroupRecord, type UserGroupStore } from './persistence/user-group.store';
import { isObjectId } from '@common/postgres';

/**
 * User groups are private, user-owned lists of registered users. They exist to
 * make sharing faster: expanding a group yields member emails that the
 * existing workspace-share flow consumes. Every operation is scoped to the
 * owner; a non-owner is treated as if the group does not exist.
 *
 * Persistence goes through USER_STORE-style port USER_GROUP_STORE (step 1A.1);
 * Mongo-backed until the cutover, PostgreSQL after — callers never change.
 */
@Injectable()
export class UserGroupService {
  constructor(
    @Inject(USER_GROUP_STORE) private readonly groupStore: UserGroupStore,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(UserGroupService.name);
  }

  async create(userId: string, dto: CreateUserGroupDto): Promise<IUserGroupResponse> {
    if (await this.groupStore.existsOwnedByName(userId, dto.name)) {
      throw new ConflictException(ErrorCode.USER_GROUP_ALREADY_EXISTS);
    }
    const created = await this.groupStore.create({
      ownerId: userId,
      name: dto.name,
      description: dto.description ?? '',
      memberIds: dto.memberIds ?? [],
    });
    this.logger.log('User group created', { groupId: created.id, userId });
    return this.toResponse(created);
  }

  async findAllForUser(userId: string): Promise<IUserGroupResponse[]> {
    const groups = await this.groupStore.findAllForUser(userId);
    return groups.map((g) => this.toResponse(g));
  }

  async findById(userId: string, id: string): Promise<IUserGroupResponse> {
    const group = await this.loadOwned(userId, id);
    return this.toResponse(group);
  }

  async findOwnedGroupIdsForMember(ownerId: string, memberId: string): Promise<string[]> {
    return this.groupStore.findOwnedGroupIdsForMember(ownerId, memberId);
  }

  async findGroupIdsForMember(memberId: string): Promise<string[]> {
    return this.groupStore.findGroupIdsForMember(memberId);
  }

  async findOwnedGroupsByIds(ownerId: string, ids: string[]): Promise<IUserGroupResponse[]> {
    const groups = await this.groupStore.findOwnedByIds(ownerId, ids);
    return groups.map((g) => this.toResponse(g));
  }

  async update(userId: string, id: string, dto: UpdateUserGroupDto): Promise<IUserGroupResponse> {
    const group = await this.loadOwned(userId, id);
    if (dto.name !== undefined && dto.name !== group.name) {
      if (await this.groupStore.existsOwnedByName(userId, dto.name, id)) {
        throw new ConflictException(ErrorCode.USER_GROUP_ALREADY_EXISTS);
      }
    }
    await this.groupStore.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    });
    this.logger.log('User group updated', { groupId: id, userId });
    return this.toResponse(await this.loadOwned(userId, id));
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.loadOwned(userId, id);
    await this.groupStore.deleteById(id);
    this.logger.log('User group deleted', { groupId: id, userId });
  }

  async addMembers(userId: string, id: string, userIds: string[]): Promise<IUserGroupResponse> {
    await this.loadOwned(userId, id);
    await this.groupStore.addMembers(id, userIds);
    this.logger.log('User group members added', { groupId: id, userId, count: userIds.length });
    return this.toResponse(await this.loadOwned(userId, id));
  }

  async removeMember(userId: string, id: string, memberId: string): Promise<IUserGroupResponse> {
    await this.loadOwned(userId, id);
    if (isObjectId(memberId)) {
      await this.groupStore.removeMember(id, memberId);
    }
    this.logger.log('User group member removed', { groupId: id, userId, memberId });
    return this.toResponse(await this.loadOwned(userId, id));
  }

  // ===== Helpers =====

  /** Load a populated group the user owns; NotFound if missing OR not owner. */
  private async loadOwned(userId: string, id: string): Promise<PopulatedGroupRecord> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    const group = await this.groupStore.findOwnedById(userId, id);
    if (!group) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    return group;
  }

  private toResponse(group: PopulatedGroupRecord): IUserGroupResponse {
    const members: IUserGroupMember[] = group.members.map((m) => ({
      id: m.id,
      email: m.email,
      firstName: m.firstName ?? undefined,
      lastName: m.lastName ?? undefined,
    }));
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      members,
      memberCount: members.length,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }
}
