import { isObjectId } from '@common/postgres/object-id';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelMcpJwtService } from '@modules/connector/services/semantic-model-mcp-jwt.service';
import { SemanticModelAssistantService } from '../services/semantic-model-assistant.service';
import { UserService } from '@modules/user/user.service';
import { assertAccountApproved } from '@modules/user/utils/assert-account-accessible';
import { UnauthorizedException } from '@modules/exceptions';

type Headers = Record<string, string | string[] | undefined>;

/**
 * Guard for the internal semantic model assistant surface, called by the semantic model MCP server.
 * Service identity is proven by the scoped principal guard; the identity of the person the agent
 * acts for comes from the backend-issued, actor-bound MCP JWT forwarded as
 * `X-YellowStorm-Mcp-Assertion` (WP06.4) — never from a naked user-id header alone.
 * In JWT mode (`SEMANTIC_MODEL_MCP_AUTH_MODE=JWT`) the assertion is REQUIRED; the header
 * fallback exists only for the developer-only Bearer mode. It loads that person's permissions,
 * so the usual permission checks apply to every call exactly as if the person had made it.
 */
@Injectable()
export class SemanticAssistantActorGuard implements CanActivate {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly users: UserService,
    private readonly config: ConfigService,
    private readonly mcpJwt: SemanticModelMcpJwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Headers; user?: unknown }>();
    const headerUserId = request.headers['x-yellowstorm-user-id'];
    const assertion = request.headers['x-yellowstorm-mcp-assertion'];
    const correlationId = request.headers['x-correlation-id'];
    if (typeof correlationId !== 'string' || !correlationId.trim() || correlationId.length > 200) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing or invalid correlation id');
    }

    // Derive the actor from the signed assertion whenever one is presented;
    // a user-id header may never disagree with it.
    let userId: string | null = null;
    if (typeof assertion === 'string' && assertion.trim()) {
      const verified = this.mcpJwt.verifyMcpAssertion(assertion.trim());
      if (!verified || !isObjectId(verified.sub)) {
        throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid semantic MCP actor assertion');
      }
      if (typeof headerUserId === 'string' && headerUserId.trim() && headerUserId.trim() !== verified.sub) {
        throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Acting user does not match the signed actor assertion');
      }
      userId = verified.sub;
    } else if (this.config.get<string>('SEMANTIC_MODEL_MCP_AUTH_MODE', 'Bearer') === 'JWT') {
      // Fail closed in JWT mode: no assertion, no call (WP06.1/WP06.4).
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Missing semantic MCP actor assertion');
    } else if (typeof headerUserId === 'string' && isObjectId(headerUserId)) {
      // Developer-only Bearer mode: the header remains the identity source.
      userId = headerUserId;
    }

    if (!userId) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing or invalid acting user');
    }

    // Downstream helpers (assistantActorFrom, model-name resolution) read the
    // header; pin it to the VERIFIED identity for the rest of the request.
    request.headers['x-yellowstorm-user-id'] = userId;
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND);
    assertAccountApproved(user);
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
