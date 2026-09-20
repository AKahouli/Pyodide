import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { SharedAgent, SharedAgentDocument } from '../schemas/shared-agent.schema';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import {
  IAgentShareEntry,
  ISharedAgentInfo,
  AgentPermissionLevel,
} from '../interfaces/agent.interface';
import { ShareAgentDto, UpdateAgentSharePermissionDto } from '../dto';
import { ErrorCode } from '../../exceptions/constants/error-codes';

interface PopulatedUser {
  _id: string;
  email: string;
  profile?: { firstName?: string; lastName?: string };
}

@Injectable()
export class AgentShareService {
  constructor(
    @InjectModel(SharedAgent.name)
    private readonly sharedAgentModel: Model<SharedAgentDocument>,
    @Inject(USER_LOOKUP_PORT) private readonly userLookup: UserLookupPort,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AgentShareService.name);
  }

  /** Batch-resolve user display info, replacing sharedWith/sharedBy Mongoose hydration (plan 1A.11). */
  private async resolveUsers(ids: string[]): Promise<Map<string, PopulatedUser>> {
    const summaries = await this.userLookup.byIds(ids);
    return new Map(
      [...summaries.values()].map((s) => [
        s.id,
        { _id: s.id, email: s.email, profile: { firstName: s.firstName, lastName: s.lastName } },
      ]),
    );
  }

  /** Share an agent with one or more users by email. Guard verifies the owner. */
  async shareAgent(
    ownerId: string,
    agentId: string,
    dto: ShareAgentDto,
  ): Promise<IAgentShareEntry[]> {
    const normalizedEmails = Array.from(
      new Set(dto.emails.map((e) => e.toLowerCase().trim()).filter(Boolean)),
    );

    const byEmail = await this.userLookup.byEmails(normalizedEmails);
    const resolved = normalizedEmails.map((email) => {
      const summary = byEmail.get(email);
      const user: PopulatedUser | undefined = summary
        ? { _id: summary.id, email: summary.email, profile: { firstName: summary.firstName, lastName: summary.lastName } }
        : undefined;
      return { email, user };
    });

    const notFound = resolved.filter((r) => !r.user).map((r) => r.email);
    const selfShare = resolved.find((r) => r.user && r.user._id.toString() === ownerId);

    if (selfShare) {
      throw new BadRequestException(ErrorCode.CUSTOM_AGENT_SHARE_SELF);
    }

    const validRecipients = resolved.filter(
      (r): r is { email: string; user: NonNullable<typeof r.user> } => !!r.user,
    );

    if (validRecipients.length === 0) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_SHARE_USER_NOT_FOUND);
    }

    const results: IAgentShareEntry[] = [];

    for (const { user } of validRecipients) {
      const share = await this.sharedAgentModel.findOneAndUpdate(
        { agentId: new Types.ObjectId(agentId), sharedWith: user._id },
        {
          $set: { permission: dto.permission, sharedBy: new Types.ObjectId(ownerId) },
          $setOnInsert: { agentId: new Types.ObjectId(agentId), sharedWith: user._id },
        },
        { upsert: true, new: true },
      );

      results.push({
        shareId: share._id.toString(),
        permission: share.permission as AgentPermissionLevel,
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.profile?.firstName,
          lastName: user.profile?.lastName,
        },
        createdAt: share.createdAt,
      });
    }

    this.logger.log('Agent shared', {
      agentId,
      ownerId,
      sharedWith: results.map((r) => r.user.email),
      permission: dto.permission,
      notFound,
    });

    return results;
  }

  /** List all shares for a given agent. Guard verifies owner. */
  async getAgentShares(agentId: string): Promise<IAgentShareEntry[]> {
    const shares = await this.sharedAgentModel
      .find({ agentId: new Types.ObjectId(agentId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const users = await this.resolveUsers(shares.map((share) => String(share.sharedWith)));

    return shares.map((share) => {
      const user = users.get(String(share.sharedWith))!;
      return {
        shareId: share._id.toString(),
        permission: share.permission as AgentPermissionLevel,
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

  /** Update a share's permission level. Guard verifies owner of `agentId`. */
  async updateSharePermission(
    agentId: string,
    shareId: string,
    dto: UpdateAgentSharePermissionDto,
  ): Promise<IAgentShareEntry> {
    if (!Types.ObjectId.isValid(shareId)) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_SHARE_NOT_FOUND);
    }

    const share = await this.sharedAgentModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(shareId), agentId: new Types.ObjectId(agentId) },
        { $set: { permission: dto.permission } },
        { new: true },
      )
      .exec();

    if (!share) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_SHARE_NOT_FOUND);
    }

    const users = await this.resolveUsers([String(share.sharedWith)]);
    const user = users.get(String(share.sharedWith))!;

    this.logger.log('Agent share permission updated', {
      shareId,
      newPermission: dto.permission,
      userId: user._id.toString(),
    });

    return {
      shareId: share._id.toString(),
      permission: share.permission as AgentPermissionLevel,
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.profile?.firstName,
        lastName: user.profile?.lastName,
      },
      createdAt: share.createdAt,
    };
  }

  /** Owner revokes a specific share. Guard verifies owner of `agentId`. */
  async removeShare(agentId: string, shareId: string): Promise<void> {
    if (!Types.ObjectId.isValid(shareId)) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_SHARE_NOT_FOUND);
    }

    const share = await this.sharedAgentModel
      .findOneAndDelete({ _id: new Types.ObjectId(shareId), agentId: new Types.ObjectId(agentId) })
      .lean()
      .exec();

    if (!share) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_SHARE_NOT_FOUND);
    }

    this.logger.log('Agent share revoked', { shareId, agentId: share.agentId.toString() });
  }

  /** Recipient removes a shared agent from their own list. */
  async unshareFromSelf(userId: string, agentId: string): Promise<void> {
    const result = await this.sharedAgentModel
      .findOneAndDelete({
        agentId: new Types.ObjectId(agentId),
        sharedWith: new Types.ObjectId(userId),
      })
      .lean()
      .exec();

    if (!result) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_SHARE_NOT_FOUND);
    }

    this.logger.log('User removed shared agent', { userId, agentId });
  }

  /** Remove all shares when an agent is permanently deleted. */
  async removeAllSharesForAgent(agentId: string): Promise<void> {
    const result = await this.sharedAgentModel
      .deleteMany({ agentId: new Types.ObjectId(agentId) })
      .exec();

    if (result.deletedCount > 0) {
      this.logger.log('All shares removed for deleted agent', {
        agentId,
        deletedCount: result.deletedCount,
      });
    }
  }

  /**
   * A map of agentId -> shareInfo for every agent shared with the user.
   * Lets the agent service attach `shareInfo` while reusing its own mapping.
   */
  async getShareInfoMapForUser(userId: string): Promise<Map<string, ISharedAgentInfo>> {
    const shares = await this.sharedAgentModel
      .find({ sharedWith: new Types.ObjectId(userId) })
      .lean()
      .exec();

    const users = await this.resolveUsers(shares.map((share) => String(share.sharedBy)));

    const shareMap = new Map<string, ISharedAgentInfo>();
    for (const share of shares) {
      const sharedByUser = users.get(String(share.sharedBy))!;
      shareMap.set(share.agentId.toString(), {
        shareId: share._id.toString(),
        permission: share.permission as AgentPermissionLevel,
        sharedBy: {
          id: sharedByUser._id.toString(),
          email: sharedByUser.email,
          firstName: sharedByUser.profile?.firstName,
          lastName: sharedByUser.profile?.lastName,
        },
      });
    }

    return shareMap;
  }

  /** The permission level a user has on an agent via sharing, or null. */
  async getSharePermission(userId: string, agentId: string): Promise<AgentPermissionLevel | null> {
    const share = await this.sharedAgentModel
      .findOne({
        agentId: new Types.ObjectId(agentId),
        sharedWith: new Types.ObjectId(userId),
      })
      .lean()
      .exec();

    return share ? (share.permission as AgentPermissionLevel) : null;
  }

  /** Full share info for a user on a specific agent, or null. */
  async getShareInfo(userId: string, agentId: string): Promise<ISharedAgentInfo | null> {
    const share = await this.sharedAgentModel
      .findOne({
        agentId: new Types.ObjectId(agentId),
        sharedWith: new Types.ObjectId(userId),
      })
      .lean()
      .exec();

    if (!share) return null;

    const users = await this.resolveUsers([String(share.sharedBy)]);
    const sharedByUser = users.get(String(share.sharedBy))!;

    return {
      shareId: share._id.toString(),
      permission: share.permission as AgentPermissionLevel,
      sharedBy: {
        id: sharedByUser._id.toString(),
        email: sharedByUser.email,
        firstName: sharedByUser.profile?.firstName,
        lastName: sharedByUser.profile?.lastName,
      },
    };
  }
}
