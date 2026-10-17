import { isObjectId } from '@common/postgres/object-id';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { BadRequestException, UnauthorizedException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { McpJwtService } from '@modules/connector/services/mcp-jwt.service';
import { UserService } from '@modules/user/user.service';
import { assertAccountApproved } from '@modules/user/utils/assert-account-accessible';

type Headers = Record<string, string | string[] | undefined>;

interface DelegatedRequest {
  headers: Headers;
  method?: string;
  route?: { path?: string };
  ip?: string;
  user?: unknown;
}

/**
 * Delegated-user identity guard for every platform-trusted MCP surface (ADR-0024).
 *
 * One shared implementation, so a domain declares itself an internal MCP surface
 * instead of writing its own actor guard. The person an agent acts for is taken
 * ONLY from the backend-issued, actor-bound assertion forwarded as
 * `X-YellowStorm-Mcp-Assertion`; a naked user-id header is never an identity
 * source and may not disagree with the signed actor (ADR-0017 §2, ADR-0024 rule 5).
 *
 * There is deliberately no per-route audience fence: a trusted MCP may call any
 * internal route for the verified user, and the ceiling is always that user's own
 * account state, roles and permissions. Service identity (which MCP is calling)
 * stays with the scoped service-principal guard next to this one.
 *
 * The assertion is required; its absence fails closed. Connector ID/revision and
 * verified-user delegation are re-checked against the current connector policy on
 * every call, so a revoked or changed policy stops working immediately.
 *
 * Every accepted delegated call is attributed (ADR-0024 §6): the verified actor,
 * the authenticated calling principal and the correlation id are recorded, which
 * is the control that replaces the audience fence. Nothing secret is recorded.
 */
@Injectable()
export class DelegatedActorGuard implements CanActivate {
  constructor(
    private readonly mcpJwt: McpJwtService,
    private readonly users: UserService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DelegatedRequest>();
    const assertion = request.headers['x-yellowstorm-mcp-assertion'];
    const headerUserId = request.headers['x-yellowstorm-user-id'];
    const principal = request.headers['x-yellowstorm-service-principal'];
    const correlationId = request.headers['x-correlation-id'];
    if (typeof correlationId !== 'string' || !correlationId.trim() || correlationId.length > 200) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing or invalid correlation id');
    }

    if (typeof assertion !== 'string' || !assertion.trim()) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Missing MCP delegated actor assertion');
    }
    const verified = await this.mcpJwt.verifyDelegatedActor(assertion.trim());
    if (!verified || !isObjectId(verified.sub)) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid MCP delegated actor assertion');
    }
    if (typeof headerUserId === 'string' && headerUserId.trim() && headerUserId.trim() !== verified.sub) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Acting user does not match the signed actor assertion');
    }

    // Pin the VERIFIED identity for the rest of the request: downstream helpers
    // (assistantActorFrom, model-name resolution) read the header.
    request.headers['x-yellowstorm-user-id'] = verified.sub;
    const user = await this.users.findById(verified.sub);
    if (!user) throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND);
    assertAccountApproved(user);
    const roles = await this.authorization.getUserRoles(verified.sub);
    const permissions = await this.authorization.getUserPermissions(roles.map((role) => role.id));
    request.user = { _id: verified.sub, permissions };

    // Attribute the call: cross-scope use stays allowed AND visible (ADR-0024 §6).
    // The matched route pattern and method go in metadata: target_id is a 24-char
    // id column, and the raw URL is never recorded (it can carry query parameters).
    const route = request.route?.path ?? 'unknown';
    this.audit.logSuccess({
      actorId: verified.sub,
      actorEmail: user.email,
      action: 'mcp.delegated_call',
      targetType: 'internal_mcp_route',
      metadata: {
        servicePrincipal: typeof principal === 'string' ? principal : 'unknown',
        correlationId,
        method: request.method ?? null,
        route,
      },
      ipAddress: request.ip,
    });
    return true;
  }
}

/**
 * Read the acting user id pinned by {@link DelegatedActorGuard}: the guard
 * overwrites `x-yellowstorm-user-id` with the verified signed subject, so
 * downstream helpers can keep reading the header (ADR-0024).
 */
export function actingUserIdFrom(headers: Record<string, string | string[] | undefined>): string {
  return String(headers['x-yellowstorm-user-id']);
}
