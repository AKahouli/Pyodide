import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { LoggerService } from '../../logger';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import { TEAM_SHARE_STORE, TEAM_STORE, type TeamRow, type TeamShareRow, type TeamShareStore, type TeamStore } from '../persistence/team.store';
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
    @Inject(TEAM_SHARE_STORE) private readonly shareStore: TeamShareStore,
    @Inject(TEAM_STORE) private readonly teamStore: TeamStore,
    @Inject(USER_LOOKUP_PORT) private readonly userLookup: UserLookupPort,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TeamShareService.name);
  }

  /** Batch-resolve user display info, replacing sharedWith/sharedBy Mongoose hydration (plan 1A.11). */
  private async resolveUsers(ids: string[]): Promise<Map<string, {
    _id: string;
    email: string;
    profile?: { firstName?: string; lastName?: string };
  }>> {
    const summaries = await this.userLookup.byIds(ids);
    return new Map(
      [...summaries.values()].map((s) => [
        s.id,
        { _id: s.id, email: s.email, profile: { firstName: s.firstName, lastName: s.lastName } },
      ]),
    );
  }

  /** Share a team with one or more users by email. Guard verifies the owner. */
  async shareTeam(ownerId: string, teamId: string, dto: ShareTeamDto): Promise<ITeamShareEntry[]> {
    const normalizedEmails = Array.from(
      new Set(dto.emails.map((e) => e.toLowerCase().trim()).filter(Boolean)),
    );

    const byEmail = await this.userLookup.byEmails(normalizedEmails);
    const resolved = normalizedEmails.map((email) => {
      const summary = byEmail.get(email);
      const user: { _id: string; email: string; profile?: { firstName?: string; lastName?: string } } | undefined = summary
        ? { _id: summary.id, email: summary.email, profile: { firstName: summary.firstName, lastName: summary.lastName } }
        : undefined;
      return { email, user };
    });

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

    // One batched upsert for the whole batch (plan 4.4).
    const shares: TeamShareRow[] = await this.shareStore.upsertMany(
      teamId,
      ownerId,
      validRecipients.map(({ user }) => user._id.toString()),
      dto.permission,
    );
    const userByShare = new Map(validRecipients.map(({ user }) => [user._id.toString(), user]));

    const results: ITeamShareEntry[] = shares.map((share) => {
      const user = userByShare.get(share.sharedWith)!;
      return {
        shareId: share.id,
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
    const shares = await this.shareStore.findByTeam(teamId);

    const users = await this.resolveUsers(shares.map((share) => String(share.sharedWith)));

    return shares.map((share) => {
      const user = users.get(String(share.sharedWith))!;
      return {
        shareId: share.id,
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
    if (!isObjectId(shareId)) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_NOT_FOUND);
    }

    const share = await this.shareStore.updatePermission(shareId, teamId, dto.permission);

    if (!share) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_NOT_FOUND);
    }

    const users = await this.resolveUsers([String(share.sharedWith)]);
    const user = users.get(String(share.sharedWith))!;

    this.logger.log('Team share permission updated', {
      shareId,
      newPermission: dto.permission,
      userId: user._id.toString(),
    });

    return {
      shareId: share.id,
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
    if (!isObjectId(shareId)) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_NOT_FOUND);
    }

    const share = await this.shareStore.deleteByIdAndTeam(shareId, teamId);

    if (!share) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_NOT_FOUND);
    }

    this.logger.log('Team share revoked', { shareId, teamId: share.teamId });
  }

  /** Recipient removes a shared team from their own list. */
  async unshareFromSelf(userId: string, teamId: string): Promise<void> {
    const result = await this.shareStore.deleteForUser(teamId, userId);

    if (!result) {
      throw new NotFoundException(ErrorCode.TEAM_SHARE_NOT_FOUND);
    }

    this.logger.log('User removed shared team', { userId, teamId });
  }

  /**
   * No longer needed (plan 4.4): shared_teams cascade on team delete via the
   * FK. Kept as a no-op for call-site compatibility.
   */
  async removeAllSharesForTeam(_teamId: string): Promise<void> {}

  /** All teams shared with a user, with shareInfo attached. */
  async getSharedTeamsForUser(userId: string): Promise<ITeamResponse[]> {
    const shares = await this.shareStore.listSharedWithUser(userId);

    if (shares.length === 0) return [];

    const users = await this.resolveUsers(shares.map((share) => String(share.sharedBy)));

    const teamIds = shares.map((s) => s.teamId);
    const teams = (await this.teamStore.findByIds(teamIds))
      .filter((t) => t.isActive)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const shareMap = new Map<string, ISharedTeamInfo>();
    for (const share of shares) {
      const sharedByUser = users.get(String(share.sharedBy))!;
      shareMap.set(share.teamId, {
        shareId: share.id,
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
      response.shareInfo = shareMap.get(team.id);
      return response;
    });
  }

  /** The permission level a user has on a team via sharing, or null. */
  async getSharePermission(userId: string, teamId: string): Promise<TeamPermissionLevel | null> {
    const share = await this.shareStore.find(teamId, userId);
    return share ? (share.permission as TeamPermissionLevel) : null;
  }

  /** Full share info for a user on a specific team, or null. */
  async getShareInfo(userId: string, teamId: string): Promise<ISharedTeamInfo | null> {
    const share = await this.shareStore.find(teamId, userId);

    if (!share) return null;

    const users = await this.resolveUsers([String(share.sharedBy)]);
    const sharedByUser = users.get(String(share.sharedBy))!;

    return {
      shareId: share.id,
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
  private toResponse(doc: TeamRow | Record<string, unknown>): ITeamResponse {
    const members = (doc.members as Array<Record<string, unknown>>) || [];
    return {
      id: doc.id as string,
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
