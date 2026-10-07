import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { TEAM_STORE, TEAM_SHARE_STORE, type TeamStore, type TeamShareStore } from '../persistence/team.store';
import { newObjectId } from '@common/postgres/object-id';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  TEAM_PERMISSION_KEY,
  RequiredTeamPermission,
} from '../decorators/require-team-permission.decorator';
import { TeamPermissionLevel } from '../interfaces/team.interface';

export interface TeamContext {
  team: unknown;
  isOwner: boolean;
  permission: TeamPermissionLevel | 'owner';
  shareId?: string;
}

interface RequestWithTeamContext {
  user: { _id: string };
  params: { id?: string };
  teamContext?: TeamContext;
}

@Injectable()
export class TeamPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TEAM_STORE) private readonly teamStore: TeamStore,
    @Inject(TEAM_SHARE_STORE) private readonly shareStore: TeamShareStore,
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

    if (!teamId || !isObjectId(teamId)) {
      throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    }

    const team = await this.teamStore.findById(teamId);

    if (!team) {
      throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    }

    const isOwner = team.createdBy === userId;

    if (isOwner) {
      request.teamContext = {
        team: team,
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
    const share = await this.shareStore.find(teamId, userId);

    if (!share) {
      throw new ForbiddenException(ErrorCode.TEAM_FORBIDDEN);
    }

    const sharePermission = share.permission as TeamPermissionLevel;

    // 'write' required but user only has 'read'.
    if (requiredPermission === 'write' && sharePermission === 'read') {
      throw new ForbiddenException(ErrorCode.TEAM_SHARE_FORBIDDEN);
    }

    request.teamContext = {
      team: team,
      isOwner: false,
      permission: sharePermission,
      shareId: share.id,
    };

    return true;
  }
}
