import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Guard for internal service-to-service authentication.
 * Validates the X-Internal-Token header against INTERNAL_SERVICE_SECRET.
 * Used for brain (gRPC service) -> NestJS calls where no user JWT is available.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  private readonly secret: string;

  constructor(private readonly configService: ConfigService) {
    this.secret = this.configService.get<string>('INTERNAL_SERVICE_SECRET', '');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.secret) {
      throw new UnauthorizedException('Internal service auth is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers['x-internal-token'] as string | undefined;

    if (!token) {
      throw new UnauthorizedException('Missing internal service token');
    }

    if (!this.safeCompare(token, this.secret)) {
      throw new UnauthorizedException('Invalid internal service token');
    }

    return true;
  }

  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
