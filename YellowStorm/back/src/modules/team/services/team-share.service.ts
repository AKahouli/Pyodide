import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { Team, TeamDocument } from '../schemas/team.schema';
import { SharedTeam, SharedTeamDocument } from '../schemas/shared-team.schema';
import { UserService } from '../../user/user.service';
import {
  ITeamResponse,
  ITeamShareEntry,
  ISharedTeamInfo,
  ITeamMemberResponse,
  TeamPermissionLevel,
} from '../interfaces/team.interface';
import { ShareTeamDto, UpdateTeamSharePermissionDto } from '../dto';
import { ErrorCode } from '../../exceptions/constants/error-codes';

@Injectable()
export class TeamShareService {
  constructor(
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
    @InjectModel(SharedTeam.name)
    private readonly sharedTeamModel: Model<SharedTeamDocument>,
    private readonly userService: UserService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TeamShareService.name);
  }

  /** Share a team with one or more users by email. Guard verifies the owner. */
  async shareTeam(ownerId: string, teamId: string, dto: ShareTeamDto): Promise<ITeamShareEntry[]> {
    const normalizedEmails = Array.from(
      new Set(dto.emails.map((e) => e.toLowerCase().trim()).filter(Boolean)),
    );

    const resolved = await Promise.all(
      normalizedEmails.map(async (email) => ({
        email,
        user: await this.userService.findByEmail(email),
      })),
    );

    const notFound = resolved.filter((r) => !r.user).map((r) => r.email);
    const selfShare = resolved.find((r) => r.user && r.user._id.toString() === ownerId);

    if (selfShare) {
      throw new BadRequestException(ErrorCode.TEAM_SHARE_SELF);
    }

    const validRecipients = resolved.filter(
      (r): r is { email: string; user: NonNullable<typeof r.user> } => !!r.user,
    );

    if (validRecipients.length === 0) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_USER_NOT_FOUND);
    }

    const results: ITeamShareEntry[] = [];

    for (const { user } of validRecipients) {
      const share = await this.sharedTeamModel.findOneAndUpdate(
        { teamId: new Types.ObjectId(teamId), sharedWith: user._id },
        {
          $set: { permission: dto.permission, sharedBy: new Types.ObjectId(ownerId) },
          $setOnInsert: { teamId: new Types.ObjectId(teamId), sharedWith: user._id },
        },
        { upsert: true, new: true },
      );

      results.push({
        shareId: share._id.toString(),
        permission: share.permission as TeamPermissionLevel,
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.profile?.firstName,
          lastName: user.profile?.lastName,
        },
        createdAt: share.createdAt,
      });
    }

    this.logger.log('Team shared', {
      teamId,
      ownerId,
      sharedWith: results.map((r) => r.user.email),
      permission: dto.permission,
      notFound,
    });

    return results;
  }

  /** List all shares for a given team. Guard verifies owner. */
  async getTeamShares(teamId: string): Promise<ITeamShareEntry[]> {
    const shares = await this.sharedTeamModel
      .find({ teamId: new Types.ObjectId(teamId) })
      .populate('sharedWith', 'email profile')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return shares.map((share) => {
      const user = share.sharedWith as unknown as {
        _id: Types.ObjectId;
        email: string;
        profile?: { firstName?: string; lastName?: string };
      };
      return {
        shareId: share._id.toString(),
        permission: share.permission as TeamPermissionLevel,
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.profile?.firstName,
          lastName: user.profile?.lastName,
        },
        createdAt: share.createdAt,
      };
    });
  }

  /** Update a share's permission level. Guard verifies owner of `teamId`. */
  async updateSharePermission(
    teamId: string,
    shareId: string,
    dto: UpdateTeamSharePermissionDto,
  ): Promise<ITeamShareEntry> {
    if (!Types.ObjectId.isValid(shareId)) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_NOT_FOUND);
    }

    const share = await this.sharedTeamModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(shareId), teamId: new Types.ObjectId(teamId) },
        { $set: { permission: dto.permission } },
        { new: true },
      )
      .populate('sharedWith', 'email profile')
      .exec();

    if (!share) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_NOT_FOUND);
    }

    const user = share.sharedWith as unknown as {
      _id: Types.ObjectId;
      email: string;
      profile?: { firstName?: string; lastName?: string };
    };

    this.logger.log('Team share permission updated', {
      shareId,
      newPermission: dto.permission,
      userId: user._id.toString(),
    });

    return {
      shareId: share._id.toString(),
      permission: share.permission as TeamPermissionLevel,
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.profile?.firstName,
        lastName: user.profile?.lastName,
      },
      createdAt: share.createdAt,
    };
  }

  /** Owner revokes a specific share. Guard verifies owner of `teamId`. */
  async removeShare(teamId: string, shareId: string): Promise<void> {
    if (!Types.ObjectId.isValid(shareId)) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_NOT_FOUND);
    }

    const share = await this.sharedTeamModel
      .findOneAndDelete({ _id: new Types.ObjectId(shareId), teamId: new Types.ObjectId(teamId) })
      .lean()
      .exec();

    if (!share) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_NOT_FOUND);
    }

    this.logger.log('Team share revoked', { shareId, teamId: share.teamId.toString() });
  }

  /** Recipient removes a shared team from their own list. */
  async unshareFromSelf(userId: string, teamId: string): Promise<void> {
    const result = await this.sharedTeamModel
      .findOneAndDelete({
        teamId: new Types.ObjectId(teamId),
        sharedWith: new Types.ObjectId(userId),
      })
      .lean()
      .exec();

    if (!result) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_NOT_FOUND);
    }

    this.logger.log('User removed shared team', { userId, teamId });
  }

  /** Remove all shares when a team is permanently deleted. */
  async removeAllSharesForTeam(teamId: string): Promise<void> {
    const result = await this.sharedTeamModel
      .deleteMany({ teamId: new Types.ObjectId(teamId) })
      .exec();

    if (result.deletedCount > 0) {
      this.logger.log('All shares removed for deleted team', {
        teamId,
        deletedCount: result.deletedCount,
      });
    }
  }

  /** All teams shared with a user, with shareInfo attached. */
  async getSharedTeamsForUser(userId: string): Promise<ITeamResponse[]> {
    const shares = await this.sharedTeamModel
      .find({ sharedWith: new Types.ObjectId(userId) })
      .populate('sharedBy', 'email profile')
      .lean()
      .exec();

    if (shares.length === 0) return [];

    const teamIds = shares.map((s) => s.teamId);
    const teams = await this.teamModel
      .find({ _id: { $in: teamIds }, isActive: true })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const shareMap = new Map<string, ISharedTeamInfo>();
    for (const share of shares) {
      const sharedByUser = share.sharedBy as unknown as {
        _id: Types.ObjectId;
        email: string;
        profile?: { firstName?: string; lastName?: string };
      };
      shareMap.set(share.teamId.toString(), {
        shareId: share._id.toString(),
        permission: share.permission as TeamPermissionLevel,
        sharedBy: {
          id: sharedByUser._id.toString(),
          email: sharedByUser.email,
          firstName: sharedByUser.profile?.firstName,
          lastName: sharedByUser.profile?.lastName,
        },
      });
    }

    return teams.map((team) => {
      const response = this.toResponse(team);
      response.shareInfo = shareMap.get(team._id.toString());
      return response;
    });
  }

  /** The permission level a user has on a team via sharing, or null. */
  async getSharePermission(userId: string, teamId: string): Promise<TeamPermissionLevel | null> {
    const share = await this.sharedTeamModel
      .findOne({
        teamId: new Types.ObjectId(teamId),
        sharedWith: new Types.ObjectId(userId),
      })
      .lean()
      .exec();

    return share ? (share.permission as TeamPermissionLevel) : null;
  }

  /** Full share info for a user on a specific team, or null. */
  async getShareInfo(userId: string, teamId: string): Promise<ISharedTeamInfo | null> {
    const share = await this.sharedTeamModel
      .findOne({
        teamId: new Types.ObjectId(teamId),
        sharedWith: new Types.ObjectId(userId),
      })
      .populate('sharedBy', 'email profile')
      .lean()
      .exec();

    if (!share) return null;

    const sharedByUser = share.sharedBy as unknown as {
      _id: Types.ObjectId;
      email: string;
      profile?: { firstName?: string; lastName?: string };
    };

    return {
      shareId: share._id.toString(),
      permission: share.permission as TeamPermissionLevel,
      sharedBy: {
        id: sharedByUser._id.toString(),
        email: sharedByUser.email,
        firstName: sharedByUser.profile?.firstName,
        lastName: sharedByUser.profile?.lastName,
      },
    };
  }

  /** Maps a lean team document to ITeamResponse (shared-team context). */
  private toResponse(doc: Record<string, unknown>): ITeamResponse {
    const members = (doc.members as Array<Record<string, unknown>>) || [];
    return {
      id: (doc._id as { toString(): string }).toString(),
      name: doc.name as string,
      description: (doc.description as string) || '',
      members: members.map((m) => this.toMemberResponse(m)),
      agentCount: members.length,
      isActive: (doc.isActive as boolean) ?? true,
      createdBy: doc.createdBy ? (doc.createdBy as { toString(): string }).toString() : '',
      createdAt: doc.createdAt as Date,
      updatedAt: doc.updatedAt as Date,
    };
  }

  private toMemberResponse(m: Record<string, unknown>): ITeamMemberResponse {
    return {
      agentId: m.agentId ? (m.agentId as { toString(): string }).toString() : '',
      parentAgentId: m.parentAgentId ? (m.parentAgentId as { toString(): string }).toString() : null,
      order: (m.order as number) ?? 0,
      positionX: (m.positionX as number) ?? 0,
      positionY: (m.positionY as number) ?? 0,
    };
  }
}
