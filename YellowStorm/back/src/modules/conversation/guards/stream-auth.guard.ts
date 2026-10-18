import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UnauthorizedException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { AuthService } from '../../auth/auth.service';
import { JWT_ALGORITHM } from '../../auth/constants/jwt.constants';

interface RequestWithSseUser extends Request {
  sseUser?: JwtPayload & { id: string };
}

/**
 * Classic conversation uses fetch Authorization. The separate v2 EventSource
 * transport retains its existing query-token compatibility.
 */
@Injectable()
export class SseAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSseUser>();
    const authorization = request.headers?.authorization;
    const bearer = typeof authorization === 'string' ? /^Bearer ([^\s]+)$/i.exec(authorization)?.[1] : undefined;
    // This guard is shared with v2, which is outside the classic migration.
    const isV2 = /^\/(?:api\/v1\/)?conversation-v2(?:\/|$)/.test(request.originalUrl?.split('?')[0] ?? '');
    const token = bearer ?? (isV2 && typeof request.query.token === 'string' ? request.query.token : undefined);

    if (!token) {
      throw new UnauthorizedException(
        ErrorCode.AUTH_TOKEN_MISSING,
        'Token required for SSE connection',
      );
    }

    // JWT verification errors (malformed/expired token) are authentication
    // failures; session-store validation happens outside this catch so a
    // transient dependency failure surfaces as 503, never as "invalid token".
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('jwt.secret'),
        issuer: this.configService.get<string>('jwt.issuer'),
        audience: this.configService.get<string>('jwt.audience'),
        algorithms: [JWT_ALGORITHM],
      });

      if (payload.type !== 'access') {
        throw new UnauthorizedException(
          ErrorCode.AUTH_TOKEN_INVALID,
          'Invalid token type for SSE connection',
        );
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(
        ErrorCode.AUTH_TOKEN_INVALID,
        'Invalid or expired token',
      );
    }

    // Validate session is still active
    if (payload.sessionId) {
      const isSessionValid = await this.authService.isSessionValid(
        payload.sessionId,
      );
      if (!isSessionValid) {
        throw new UnauthorizedException(
          ErrorCode.AUTH_SESSION_REVOKED,
          'Session has been revoked',
        );
      }
    }

    // Attach user info to request for controller access
    // JWT uses `sub` for user ID; normalise to `id` so controllers can use user.id uniformly
    request.sseUser = { ...payload, id: payload.sub };
    return true;
  }
}
