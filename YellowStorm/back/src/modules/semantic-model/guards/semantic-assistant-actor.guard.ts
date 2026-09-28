import { isObjectId } from '@common/postgres/object-id';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthorizationService } from '@modules/authorization';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelAssistantService } from '../services/semantic-model-assistant.service';

type Headers = Record<string, string | string[] | undefined>;

/**
 * Guard for the internal semantic model assistant surface, called by the semantic model MCP server
 * with X-Internal-Token (checked first by InternalServiceGuard) and the identity of the person the
 * agent acts for. It loads that person's permissions, so the usual permission checks apply to every
 * call exactly as if the person had made it.
 */
@Injectable()
export class SemanticAssistantActorGuard implements CanActivate {
  constructor(private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Headers; user?: unknown }>();
    const userId = request.headers['x-yellowstorm-user-id'];
    const correlationId = request.headers['x-correlation-id'];
    if (typeof userId !== 'string' || !isObjectId(userId)) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing or invalid acting user');
    }
    if (typeof correlationId !== 'string' || !correlationId.trim() || correlationId.length > 200) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing or invalid correlation id');
    }
    const roles = await this.authorization.getUserRoles(userId);
    const permissions = await this.authorization.getUserPermissions(roles.map((role) => role.id));
    request.user = { _id: userId, permissions };
    return true;
  }
}

/**
 * Lets the assistant surface name a model by its id or by its exact name ("Billing & Contract
 * Management"): a name is turned into the id of the one model with that name the person can see.
 */
@Injectable()
export class SemanticAssistantModelGuard implements CanActivate {
  constructor(private readonly assistant: SemanticModelAssistantService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Headers; params?: Record<string, string> }>();
    const reference = request.params?.modelId;
    if (reference) request.params!.modelId = await this.assistant.resolveModelId(String(request.headers['x-yellowstorm-user-id']), reference);
    return true;
  }
}

const header = (headers: Headers, name: string) => {
  const value = headers[name];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
};

/** The person, agent and conversation behind a call already checked by {@link SemanticAssistantActorGuard}. */
export function assistantActorFrom(headers: Headers) {
  return {
    userId: String(headers['x-yellowstorm-user-id']),
    agentId: header(headers, 'x-yellowstorm-agent-id'),
    conversationId: header(headers, 'x-yellowstorm-conversation-id'),
  };
}
