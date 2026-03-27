import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UserService } from '../../user/user.service';
import { AuthService } from '../auth.service';
import { UnauthorizedException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {
    const secret = configService.get<string>('jwt.secret');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
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

    // Validate session is still active (enables immediate revocation)
    if (payload.sessionId) {
      const isSessionValid = await this.authService.isSessionValid(payload.sessionId);
      if (!isSessionValid) {
        throw new UnauthorizedException(ErrorCode.AUTH_SESSION_REVOKED, 'Session has been revoked');
      }
    }

    const user = await this.userService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    if (user.status === 'suspended') {
      throw new UnauthorizedException(ErrorCode.AUTH_ACCOUNT_SUSPENDED, 'Account is suspended');
    }

    // Attach JWT payload data to user for use in guards
    // This allows PermissionsGuard to check permissions without DB lookup
    (user as unknown as Record<string, unknown>).permissions = payload.permissions || [];
    (user as unknown as Record<string, unknown>).roleNames = payload.roleNames || [];
    (user as unknown as Record<string, unknown>).permissionsVersion = payload.permissionsVersion || 1;

    return user;
  }
}
