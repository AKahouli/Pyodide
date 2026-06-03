import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { Request } from 'express';
import { createHash } from 'crypto';
import { UnauthorizedException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WidgetToken, WidgetTokenDocument } from '../schemas/widget-token.schema';
import { Agent, AgentDocument } from '@modules/agent/schemas/agent.schema';

interface RequestWithWidget extends Request {
  widgetTokenHash?: string;
  widgetAgentId?: string;
  widgetAgent?: AgentDocument;
}

@Injectable()
export class WidgetTokenGuard implements CanActivate {
  constructor(
    @InjectModel(WidgetToken.name) private readonly widgetTokenModel: Model<WidgetTokenDocument>,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
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

    const widgetToken = await this.widgetTokenModel.findOne({ tokenHash, isActive: true });
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

    const agent = await this.agentModel.findById(widgetToken.agentId).lean().exec() as any;
    if (!agent || !agent.isActive) {
      throw new NotFoundException(ErrorCode.WIDGET_AGENT_NOT_FOUND, 'Agent not found or inactive');
    }

    request.widgetTokenHash = tokenHash;
    request.widgetAgentId = widgetToken.agentId.toString();
    request.widgetAgent = agent;

    return true;
  }
}
