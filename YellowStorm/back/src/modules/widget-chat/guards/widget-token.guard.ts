import { Injectable,  CanActivate,  ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LoggerService } from '@modules/logger';
import { Request } from 'express';
import { createHash } from 'crypto';
import { UnauthorizedException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { AgentRepository } from '@modules/agent/repositories/agent.repository';
import { AgentRecord } from '@modules/agent/repositories/agent-record.mapper';
import { WIDGET_DEPLOYMENT_MODE_KEY, type WidgetDeploymentMode } from '../decorators/widget-deployment-mode.decorator';
import { PgWidgetTokenStore } from '../persistence/pg-widget.store';

interface RequestWithWidget extends Request {
  widgetTokenHash?: string;
  widgetAgentId?: string;
  widgetAgent?: AgentRecord;
}

@Injectable()
export class WidgetTokenGuard implements CanActivate {
  constructor(
    private readonly widgetTokenStore: PgWidgetTokenStore,
    private readonly agentRepository: AgentRepository,
    private readonly reflector: Reflector,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WidgetTokenGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithWidget>();

    const authHeader = request.headers.authorization as string | undefined;
    const queryToken = request.query.token as string | undefined;
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

    if (!rawToken) {
      this.logger.warn('Widget auth failed: missing token', { path: request.path, origin: request.headers.origin });
      throw new UnauthorizedException(ErrorCode.WIDGET_TOKEN_INVALID, 'Widget token is required');
    }

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    // Active only; expiry checked in code (plan 4.12 parity).
    const widgetToken = await this.widgetTokenStore.findActiveByHash(tokenHash);
    if (!widgetToken) {
      this.logger.warn('Widget auth failed: invalid token hash', { path: request.path, origin: request.headers.origin });
      throw new UnauthorizedException(ErrorCode.WIDGET_TOKEN_INVALID, 'Invalid or inactive widget token');
    }

    if (widgetToken.expiresAt && widgetToken.expiresAt < new Date()) {
      throw new UnauthorizedException(ErrorCode.WIDGET_TOKEN_EXPIRED, 'Widget token has expired');
    }

    const requestOrigin = request.headers.origin as string | undefined;
    const referer = request.headers.referer as string | undefined;
    const origin = requestOrigin || (referer ? new URL(referer).origin : undefined);

    if (origin && widgetToken.allowedOrigins.length > 0) {
      const allowed = widgetToken.allowedOrigins.some((o) => {
        try {
          return new URL(o).origin === origin;
        } catch {
          return false;
        }
      });
      if (!allowed) {
        this.logger.warn('Widget auth failed: origin not in token allowlist', {
          origin,
          allowedOrigins: widgetToken.allowedOrigins,
          agentId: widgetToken.agentId.toString(),
        });
        throw new ForbiddenException(ErrorCode.WIDGET_ORIGIN_NOT_ALLOWED, 'This widget is not allowed on the current domain');
      }
    }

    this.logger.debug('Widget auth ok', {
      path: request.path,
      agentId: widgetToken.agentId.toString(),
      origin: origin ?? null,
    });

    const agent = await this.agentRepository.findById(widgetToken.agentId.toString());
    if (!agent || !agent.isActive) {
      throw new NotFoundException(ErrorCode.WIDGET_AGENT_NOT_FOUND, 'Agent not found or inactive');
    }

    const mode = this.reflector.getAllAndOverride<WidgetDeploymentMode>(WIDGET_DEPLOYMENT_MODE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? (request.path.startsWith('/integrations/') ? 'rest' : 'embed');
    const deploymentSettings = agent.deploymentSettings as { embedEnabled?: boolean; restEnabled?: boolean } | undefined;
    if (mode === 'embed' && deploymentSettings?.embedEnabled !== true) {
      throw new ForbiddenException(ErrorCode.WIDGET_TOKEN_INVALID, 'Embed widget deployment is disabled for this agent');
    }
    if (mode === 'rest' && deploymentSettings?.restEnabled !== true) {
      throw new ForbiddenException(ErrorCode.WIDGET_TOKEN_INVALID, 'REST API deployment is disabled for this agent');
    }

    request.widgetTokenHash = tokenHash;
    request.widgetAgentId = widgetToken.agentId.toString();
    request.widgetAgent = agent;

    return true;
  }
}
