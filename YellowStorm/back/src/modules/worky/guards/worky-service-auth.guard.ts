import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../exceptions/constants/error-codes';

export const WORKY_SERVICE_TOKEN_HEADER = 'x-service-token';
export const WORKY_EVENT_ID_HEADER = 'x-event-id';

interface ServiceAuthRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Service-to-service auth guard for the `/worky/internal/*` callback
 * surface. Bypasses `JwtAuthGuard` (the global APP_GUARD). Validates a
 * shared secret via the `X-Service-Token` header against
 * `WORKY_SERVICE_TOKEN` from config.
 *
 * The canonical plan calls for mTLS or signed-JWT (canonical §6.2). The
 * shared-secret pattern matches the existing `INTERNAL_SERVICE_SECRET`
 * precedent in `agent.service.ts`; swapping to mTLS is a future hardening
 * task and is intentionally out of Part 1's scope.
 */
@Injectable()
export class WorkyServiceAuthGuard implements CanActivate {
  private readonly expectedToken: string;

  constructor(config: ConfigService) {
    const token = config.get<string>('worky.serviceToken', '');
    this.expectedToken = token;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.expectedToken) {
      throw new UnauthorizedException(
        ErrorCode.WORKY_SERVICE_AUTH_FAILED,
        'Worky service auth is not configured (WORKY_SERVICE_TOKEN missing).',
      );
    }
    const req = context.switchToHttp().getRequest<ServiceAuthRequest>();
    const presented = this.headerValue(req, WORKY_SERVICE_TOKEN_HEADER);
    if (!presented || presented !== this.expectedToken) {
      throw new UnauthorizedException(
        ErrorCode.WORKY_SERVICE_AUTH_FAILED,
        'Invalid or missing Worky service token.',
      );
    }
    return true;
  }

  private headerValue(req: ServiceAuthRequest, name: string): string | undefined {
    const raw = req.headers[name.toLowerCase()];
    if (Array.isArray(raw)) return raw[0];
    return raw;
  }
}
