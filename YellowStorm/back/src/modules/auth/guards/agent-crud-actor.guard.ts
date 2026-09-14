import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

/**
 * Guard for the internal agent-crud surface (`/internal/agent-crud/*`).
 * The mcp-agent MCP server calls these endpoints with X-Internal-Token plus
 * the trusted identity headers stamped on its connector bindings; this guard
 * validates the acting user identity before the controllers act on it.
 */
@Injectable()
export class AgentCrudActorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const headers = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>().headers;
    const userId = headers['x-yellowstorm-user-id'];
    const correlationId = headers['x-correlation-id'];
    if (typeof userId !== 'string' || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing or invalid trusted agent-crud acting user');
    }
    if (typeof correlationId !== 'string' || !correlationId.trim() || correlationId.length > 200) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing or invalid trusted agent-crud correlation id');
    }
    return true;
  }
}

/** Read the acting user id previously validated by {@link AgentCrudActorGuard}. */
export function actingUserIdFrom(headers: Record<string, string | string[] | undefined>): string {
  return String(headers['x-yellowstorm-user-id']);
}
