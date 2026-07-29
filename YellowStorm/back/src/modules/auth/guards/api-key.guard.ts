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
 * Guard for simple static API-key authentication, intended for third-party
 * integrations. Validates the `X-API-Key` header against THIRD_PARTY_API_KEY.
 *
 * Fails closed: if the secret is not configured, every request is rejected.
 * Use together with `@Public()` so it runs in place of the global JWT guard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('THIRD_PARTY_API_KEY', '');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.apiKey) {
      throw new UnauthorizedException('Third-party API access is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-api-key'] as string | undefined;

    if (!provided) {
      throw new UnauthorizedException('Missing API key');
    }

    if (!this.safeCompare(provided, this.apiKey)) {
      throw new UnauthorizedException('Invalid API key');
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
