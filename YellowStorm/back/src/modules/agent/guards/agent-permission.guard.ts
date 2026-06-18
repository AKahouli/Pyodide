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
import { Agent, AgentDocument } from '../schemas/agent.schema';
import { SharedAgent, SharedAgentDocument } from '../schemas/shared-agent.schema';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  AGENT_PERMISSION_KEY,
  RequiredAgentPermission,
} from '../decorators/require-agent-permission.decorator';
import { AgentPermissionLevel } from '../interfaces/agent.interface';

export interface AgentContext {
  agent: AgentDocument;
  isOwner: boolean;
  permission: AgentPermissionLevel | 'owner';
  shareId?: string;
}

interface RequestWithAgentContext {
  user: { _id: Types.ObjectId };
  params: { id?: string };
  agentContext?: AgentContext;
}

@Injectable()
export class AgentPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    @InjectModel(SharedAgent.name)
    private readonly sharedAgentModel: Model<SharedAgentDocument>,
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
    const agentId = request.params.id;

    if (!agentId || !Types.ObjectId.isValid(agentId)) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    const agent = await this.agentModel
      .findById(agentId)
      .select('createdBy isActive isDefault')
      .lean()
      .exec();

    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    const isOwner = agent.createdBy.toString() === userId;

    if (isOwner) {
      request.agentContext = {
        agent: agent as AgentDocument,
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
    const share = await this.sharedAgentModel
      .findOne({
        agentId: new Types.ObjectId(agentId),
        sharedWith: new Types.ObjectId(userId),
      })
      .lean()
      .exec();

    if (!share) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
    }

    const sharePermission = share.permission as AgentPermissionLevel;

    // 'write' required but user only has 'read'.
    if (requiredPermission === 'write' && sharePermission === 'read') {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_SHARE_FORBIDDEN);
    }

    request.agentContext = {
      agent: agent as AgentDocument,
      isOwner: false,
      permission: sharePermission,
      shareId: share._id.toString(),
    };

    return true;
  }
}
