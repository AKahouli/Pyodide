import { isObjectId } from '@common/postgres/object-id';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

interface ActorRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Guard for the internal Pyodide relay surface (`/internal/pyodide-runtime/*`).
 *
 * The mcp-pyodide server calls these endpoints with `X-Internal-Token` (checked
 * first by `InternalServiceGuard`) plus the trusted actor headers stamped on
 * its connector binding. The acting user is mandatory and authoritative; the
 * agent, conversation and correlation headers are optional tracing context.
 */
@Injectable()
export class PyodideActorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const headers = context.switchToHttp().getRequest<ActorRequest>().headers;
    const userId = headers['x-yellowstorm-user-id'];
    if (typeof userId !== 'string' || !isObjectId(userId)) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing or invalid trusted pyodide acting user');
    }
    const correlationId = headers['x-correlation-id'];
    if (typeof correlationId === 'string' && correlationId.length > 200) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Invalid trusted pyodide correlation id');
    }
    return true;
  }
}

/** Read the acting user id previously validated by {@link PyodideActorGuard}. */
export function pyodideActingUserIdFrom(headers: Record<string, string | string[] | undefined>): string {
  return String(headers['x-yellowstorm-user-id']);
}
