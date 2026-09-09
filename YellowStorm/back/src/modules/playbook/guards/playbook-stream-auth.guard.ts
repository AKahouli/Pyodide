import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UnauthorizedException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { AuthService } from '../../auth/auth.service';

interface RequestWithSseUser extends Request {
  sseUser?: JwtPayload;
}

@Injectable()
export class PlaybookStreamAuthGuard implements CanActivate {
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

    // JWT verification errors (malformed/expired token) are authentication
    // failures; session-store validation happens outside this catch so a
    // transient dependency failure surfaces as 503, never as "invalid token".
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
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
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(
        ErrorCode.AUTH_TOKEN_INVALID,
        'Invalid or expired token',
      );
    }

    if (payload.sessionId) {
      const isSessionValid = await this.authService.isSessionValid(payload.sessionId);
      if (!isSessionValid) {
        throw new UnauthorizedException(
          ErrorCode.AUTH_SESSION_REVOKED,
          'Session has been revoked',
        );
      }
    }

    request.sseUser = payload;
    return true;
  }
}
