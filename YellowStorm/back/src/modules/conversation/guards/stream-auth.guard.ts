import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UnauthorizedException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { AuthService } from '../../auth/auth.service';

interface RequestWithSseUser extends Request {
  sseUser?: JwtPayload & { id: string };
}

/**
 * Guard for SSE endpoints that validates JWT from query parameter
 * EventSource API doesn't support custom headers, so we use query params
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
    const token = request.query.token as string;

    if (!token) {
      throw new UnauthorizedException(
        ErrorCode.AUTH_TOKEN_MISSING,
        'Token required for SSE connection',
      );
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('jwt.secret'),
        issuer: this.configService.get<string>('jwt.issuer'),
        audience: this.configService.get<string>('jwt.audience'),
      });

      if (payload.type !== 'access') {
        throw new UnauthorizedException(
          ErrorCode.AUTH_TOKEN_INVALID,
          'Invalid token type for SSE connection',
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
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(
        ErrorCode.AUTH_TOKEN_INVALID,
        'Invalid or expired token',
      );
    }
  }
}
