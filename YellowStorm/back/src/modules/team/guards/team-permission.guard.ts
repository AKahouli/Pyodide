import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Team, TeamDocument } from '../schemas/team.schema';
import { SharedTeam, SharedTeamDocument } from '../schemas/shared-team.schema';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  TEAM_PERMISSION_KEY,
  RequiredTeamPermission,
} from '../decorators/require-team-permission.decorator';
import { TeamPermissionLevel } from '../interfaces/team.interface';

export interface TeamContext {
  team: TeamDocument;
  isOwner: boolean;
  permission: TeamPermissionLevel | 'owner';
  shareId?: string;
}

interface RequestWithTeamContext {
  user: { _id: Types.ObjectId };
  params: { id?: string };
  teamContext?: TeamContext;
}

@Injectable()
export class TeamPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
    @InjectModel(SharedTeam.name)
    private readonly sharedTeamModel: Model<SharedTeamDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<RequiredTeamPermission>(
      TEAM_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithTeamContext>();
    const userId = request.user._id.toString();
    const teamId = request.params.id;

    if (!teamId || !Types.ObjectId.isValid(teamId)) {
      throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    }

    const team = await this.teamModel
      .findById(teamId)
      .select('createdBy isActive')
      .lean()
      .exec();

    if (!team) {
      throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    }

    const isOwner = team.createdBy.toString() === userId;

    if (isOwner) {
      request.teamContext = {
        team: team as TeamDocument,
        isOwner: true,
        permission: 'owner',
      };
      return true;
    }

    // Owner-only endpoints reject non-owners immediately.
    if (requiredPermission === 'owner') {
      throw new ForbiddenException(ErrorCode.TEAM_SHARE_FORBIDDEN);
    }

    // Check shared access.
    const share = await this.sharedTeamModel
      .findOne({
        teamId: new Types.ObjectId(teamId),
        sharedWith: new Types.ObjectId(userId),
      })
      .lean()
      .exec();

    if (!share) {
      throw new ForbiddenException(ErrorCode.TEAM_FORBIDDEN);
    }

    const sharePermission = share.permission as TeamPermissionLevel;

    // 'write' required but user only has 'read'.
    if (requiredPermission === 'write' && sharePermission === 'read') {
      throw new ForbiddenException(ErrorCode.TEAM_SHARE_FORBIDDEN);
    }

    request.teamContext = {
      team: team as TeamDocument,
      isOwner: false,
      permission: sharePermission,
      shareId: share._id.toString(),
    };

    return true;
  }
}
