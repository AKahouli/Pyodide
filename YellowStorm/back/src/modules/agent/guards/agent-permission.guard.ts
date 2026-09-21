import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { Types } from 'mongoose';
import { isObjectId } from '@common/postgres';
import { AgentRepository } from '../repositories/agent.repository';
import { AgentRecord } from '../repositories/agent-record.mapper';
import { AGENT_SHARE_STORE, type AgentShareStore } from '../persistence/agent-share.store';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  AGENT_PERMISSION_KEY,
  RequiredAgentPermission,
} from '../decorators/require-agent-permission.decorator';
import { AgentPermissionLevel } from '../interfaces/agent.interface';

export interface AgentContext {
  agent: AgentRecord;
  isOwner: boolean;
  permission: AgentPermissionLevel | 'owner';
  shareId?: string;
}

interface RequestWithAgentContext {
  user: { _id: Types.ObjectId; permissions?: string[] };
  params: { id?: string; agentId?: string };
  agentContext?: AgentContext;
}

@Injectable()
export class AgentPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly agentRepository: AgentRepository,
    @Inject(AGENT_SHARE_STORE)
    private readonly shareStore: AgentShareStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<RequiredAgentPermission>(
      AGENT_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAgentContext>();
    const userId = request.user._id.toString();
    const agentId = request.params.id ?? request.params.agentId;

    if (!agentId || !isObjectId(agentId)) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    const agent = await this.agentRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    const isOwner = agent.createdBy.toString() === userId;

    if (agent.isDefault) {
      if (requiredPermission === 'owner') {
        throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_SHARE_FORBIDDEN);
      }

      const permissions = request.user.permissions ?? [];
      const canManage = permissions.some(
        (permission) => permission === '*' || permission === 'agents.*' || permission === 'agents.update',
      );

      if (requiredPermission !== 'read' && !canManage) {
        throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY);
      }

      request.agentContext = {
        agent,
        isOwner: false,
        permission: requiredPermission === 'read' ? 'read' : 'owner',
      };
      return true;
    }

    if (isOwner) {
      request.agentContext = {
        agent,
        isOwner: true,
        permission: 'owner',
      };
      return true;
    }

    // Owner-only endpoints reject non-owners immediately.
    if (requiredPermission === 'owner') {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_SHARE_FORBIDDEN);
    }

    // Check shared access.
    const share = await this.shareStore.find(agentId, userId);

    if (!share) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
    }

    const sharePermission = share.permission as AgentPermissionLevel;

    // 'write' required but user only has 'read'.
    if (requiredPermission === 'write' && sharePermission === 'read') {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_SHARE_FORBIDDEN);
    }

    request.agentContext = {
      agent,
      isOwner: false,
      permission: sharePermission,
      shareId: share.id,
    };

    return true;
  }
}
