import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Machine-identity matrix for scoped internal principals (WP07.1/WP07.2/WP07.3):
 *
 * | Principal          | Allowed endpoint group                    | Env secret                        |
 * | ------------------ | ----------------------------------------- | --------------------------------- |
 * | semantic-model-mcp | internal semantic assistant, MCP token    | SEMANTIC_MODEL_MCP_SERVICE_TOKEN  |
 * | app-runtime        | app-runtime bind + tool invoke            | APP_RUNTIME_BIND_TOKEN            |
 *
 * Identity comes from possession of the per-service secret — never from a
 * plain service-name header (WP07.2). Each secret is checked with a
 * constant-time comparison and denied when unset (fail closed, WP07.6).
 * End-user authorization continues to flow through the WP-06 actor
 * assertion; the principal only proves WHICH service is calling.
 */
export type InternalServicePrincipal = 'semantic-model-mcp' | 'app-runtime' | 'adk-runtime';

const PRINCIPAL_TOKEN_ENV: Record<InternalServicePrincipal, string> = {
  'adk-runtime': 'ADK_RUNTIME_MCP_RENEWAL_TOKEN',
  'semantic-model-mcp': 'SEMANTIC_MODEL_MCP_SERVICE_TOKEN',
  'app-runtime': 'APP_RUNTIME_BIND_TOKEN',
};

const PRINCIPAL_HEADER = 'x-yellowstorm-service-principal';
const TOKEN_HEADER = 'x-yellowstorm-service-token';

abstract class PrincipalGuardBase implements CanActivate {
  protected constructor(
    private readonly configService: ConfigService,
    private readonly principal: InternalServicePrincipal,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = (this.configService.get<string>(PRINCIPAL_TOKEN_ENV[this.principal]) ?? '').trim();
    if (!secret) {
      // Fail closed on configuration errors (WP07.6) instead of allowing a
      // broad permissive fallback.
      throw new UnauthorizedException(`Internal service principal "${this.principal}" is not configured`);
    }

    const request = context.switchToHttp().getRequest<Request>();
    const declaredPrincipal = request.headers[PRINCIPAL_HEADER] as string | undefined;
    const token = request.headers[TOKEN_HEADER] as string | undefined;

    if (!declaredPrincipal || !token) {
      throw new UnauthorizedException('Missing internal service principal or token');
    }
    // The declared principal selects WHICH secret is compared; possession of
    // the matching per-service secret is the identity proof.
    if (declaredPrincipal !== this.principal) {
      throw new UnauthorizedException('Internal service principal does not match this endpoint group');
    }
    if (!this.safeCompare(token, secret)) {
      throw new UnauthorizedException('Invalid internal service principal token');
    }
    return true;
  }

  private safeCompare(a: string, b: string): boolean {
    if (typeof a !== 'string' || Buffer.byteLength(a) !== Buffer.byteLength(b)) {
      return false;
    }
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}

/**
 * Build a guard class bound to ONE principal, so a controller declares its
 * allowed caller service in code and no other principal's secret is even
 * considered on that endpoint group (WP07.3).
 */
export function internalServicePrincipalGuardFor(principal: InternalServicePrincipal): new (configService: ConfigService) => CanActivate {
  @Injectable()
  class ScopedInternalServicePrincipalGuard extends PrincipalGuardBase {
    constructor(configService: ConfigService) {
      super(configService, principal);
    }
  }
  Object.defineProperty(ScopedInternalServicePrincipalGuard, 'name', { value: `${principal}PrincipalGuard` });
  return ScopedInternalServicePrincipalGuard;
}

/** The semantic MCP server's principal: semantic assistant + MCP token renewal only. */
export const SemanticMcpServiceGuard = internalServicePrincipalGuardFor('semantic-model-mcp');

/** The app runtime's principal: bind and tool-invoke only (WP07.3). */
export const AppRuntimeServiceGuard = internalServicePrincipalGuardFor('app-runtime');
export const AdkRuntimeMcpRenewalGuard = internalServicePrincipalGuardFor('adk-runtime');
