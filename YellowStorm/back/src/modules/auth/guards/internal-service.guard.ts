import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Legacy guard for internal service-to-service authentication on the
 * non-semantic internal routes (document ingest, workspace ingest, connector
 * transfer, root delegate, telegram validation, agent/team CRUD). Validates
 * the `X-Internal-Token` header against `INTERNAL_SERVICE_SECRET`.
 *
 * Trust-domain note (WP07.4): `APP_RUNTIME_BIND_TOKEN` is NOT accepted here —
 * it is valid only for the app-runtime bind surface via the scoped
 * AppRuntimeServiceGuard, and the semantic privileged surfaces use
 * SemanticMcpServiceGuard. This shared secret remains a narrowly bounded
 * compatibility path for the remaining internal callers with a documented
 * removal gate; it is never a universal fallback for semantic privileged
 * endpoints.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  private readonly secret: string;

  constructor(private readonly configService: ConfigService) {
    this.secret = (this.configService.get<string>('INTERNAL_SERVICE_SECRET') ?? '').trim();
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
