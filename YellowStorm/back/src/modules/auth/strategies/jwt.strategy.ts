import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UserService } from '../../user/user.service';
import { AuthService } from '../auth.service';
import { SESSION_STORE } from '../persistence/session.store';
import type { SessionStore } from '../persistence/session.store';
import { toAuthUser } from '../../user/persistence/user-record.mapper';
import { UnauthorizedException, ServiceUnavailableException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { getAccountAccessDenial } from '../../user/utils/assert-account-accessible';
import { classifySessionStoreError, isTransientSessionStoreError } from '../utils/session-store-errors';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    @Inject(SESSION_STORE) private readonly sessionStore: SessionStore,
  ) {
    const secret = configService.get<string>('jwt.secret');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => {
          return req?.query?.token;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
      issuer: configService.get<string>('jwt.issuer'),
      audience: configService.get<string>('jwt.audience'),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid token type');
    }

    // Plan 1A.13: session validity + user row in ONE store lookup (joined PK
    // query in PostgreSQL), enabling immediate revocation without a second
    // round-trip.
    if (payload.sessionId) {
      let found: Awaited<ReturnType<SessionStore['findValidByIdWithUser']>>;
      try {
        found = await this.sessionStore.findValidByIdWithUser(payload.sessionId);
      } catch (error: unknown) {
        if (isTransientSessionStoreError(error)) {
          throw new ServiceUnavailableException(
            ErrorCode.AUTH_DEPENDENCY_UNAVAILABLE,
            'Session store is temporarily unavailable',
          );
        }
        classifySessionStoreError(error);
        throw error;
      }
      if (!found || !found.valid) {
        throw new UnauthorizedException(ErrorCode.AUTH_SESSION_REVOKED, 'Session has been revoked');
      }
      if (found.user.id !== payload.sub) {
        throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'User not found');
      }
      const accessDenial = getAccountAccessDenial(found.user.status);
      if (accessDenial) {
        throw new UnauthorizedException(accessDenial.code, accessDenial.message);
      }
      return toAuthUser(found.user, {
        permissions: payload.permissions || [],
        roleNames: payload.roleNames || [],
        permissionsVersion: payload.permissionsVersion || 1,
      });
    }

    const user = await this.userService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    const accessDenial = getAccountAccessDenial(user.status);
    if (accessDenial) {
      throw new UnauthorizedException(accessDenial.code, accessDenial.message);
    }

    return {
      ...user,
      permissions: payload.permissions || [],
      roleNames: payload.roleNames || [],
      permissionsVersion: payload.permissionsVersion || 1,
    };
  }
}
