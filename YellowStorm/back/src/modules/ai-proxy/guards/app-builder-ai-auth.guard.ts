import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ForbiddenException, UnauthorizedException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { AuthService } from '../../auth/auth.service';
import { UserService } from '../../user/user.service';
import type { UserDocLike } from '../../user/persistence/user-record.mapper';
import { AppDataClientService } from '../../app-data/services/app-data-client.service';
import { AppDataCatalogService } from '../../app-data/services/app-data-catalog.service';
import { AppDataEndUserAuthService } from '../../app-data/services/app-data-end-user-auth.service';
import { AppDataEndUserGrantsService } from '../../app-data/services/app-data-end-user-grants.service';
import { AppDataGrantDeniedException } from '../../app-data/constants/app-data.errors';
import { RuntimeBindingService } from '../../app-runtime/services/runtime-binding.service';
import {
  AI_PREVIEW_TICKET_PREFIX,
  AiPreviewTicketService,
} from '../services/ai-preview-ticket.service';

interface AppEndUserJwtHints {
  typ?: string;
  appDataId?: string;
  sub?: string;
}

type AiProxyAuthedRequest = Request & {
  user?: UserDocLike;
  aiProxyAuth?: {
    mode: 'platform' | 'app_end_user' | 'ai_preview';
    appDataId?: string;
    endUserId?: string;
    workspaceId?: string;
  };
};

/**
 * Auth for Approach B generated apps:
 * - Opaque AI preview ticket (`aiprev_…`) billed to session owner, or
 * - App Data end-user JWT (`typ: app_end_user`) billed to the app owner, or
 * - Platform YellowStorm access JWT (internal tools).
 */
@Injectable()
export class AppBuilderAiAuthGuard implements CanActivate {
  private readonly logger = new Logger(AppBuilderAiAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly authService: AuthService,
    @Optional() private readonly appDataClient?: AppDataClientService,
    @Optional() private readonly appDataCatalog?: AppDataCatalogService,
    @Optional() private readonly endUserAuth?: AppDataEndUserAuthService,
    @Optional() private readonly endUserGrants?: AppDataEndUserGrantsService,
    @Optional() private readonly aiPreviewTickets?: AiPreviewTicketService,
    @Optional() private readonly runtimeBindings?: RuntimeBindingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AiProxyAuthedRequest>();
    const token = this.extractBearer(request);
    if (!token) {
      throw new UnauthorizedException(ErrorCode.UNAUTHORIZED, 'Authentication required');
    }

    if (token.startsWith(AI_PREVIEW_TICKET_PREFIX)) {
      const verified = await this.verifyAiPreviewTicket(token);
      request.user = verified.user;
      request.aiProxyAuth = {
        mode: 'ai_preview',
        workspaceId: verified.workspaceId,
      };
      return true;
    }

    const hints = this.decodeHints(token);
    if (hints?.typ === 'app_end_user') {
      request.user = await this.authenticateAppEndUser(token, hints);
      request.aiProxyAuth = {
        mode: 'app_end_user',
        appDataId: hints.appDataId,
        endUserId: hints.sub,
      };
      return true;
    }

    request.user = await this.authenticatePlatformAccess(token);
    request.aiProxyAuth = { mode: 'platform' };
    return true;
  }

  private async verifyAiPreviewTicket(
    ticket: string,
  ): Promise<{ user: UserDocLike; workspaceId: string }> {
    if (!this.aiPreviewTickets) {
      throw new UnauthorizedException(
        ErrorCode.UNAUTHORIZED,
        'AI preview tickets are not available',
      );
    }

    const verified = await this.aiPreviewTickets.verify(ticket);
    if (!verified) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid or expired AI preview ticket');
    }

    const user = await this.userService.findById(verified.billableUserId);
    if (!user) {
      throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'AI preview billable user not found');
    }

    return { user, workspaceId: verified.workspaceId };
  }

  private extractBearer(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    return token || null;
  }

  private decodeHints(token: string): AppEndUserJwtHints | null {
    try {
      return this.jwtService.decode(token);
    } catch {
      return null;
    }
  }

  private async authenticatePlatformAccess(token: string): Promise<UserDocLike> {
    const secret = this.configService.get<string>('jwt.secret');
    if (!secret) {
      throw new UnauthorizedException(ErrorCode.UNAUTHORIZED, 'JWT is not configured');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret,
        issuer: this.configService.get<string>('jwt.issuer'),
        audience: this.configService.get<string>('jwt.audience'),
      });
    } catch {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid or expired token');
    }

    if (payload.type !== 'access') {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid token type');
    }

    if (payload.sessionId) {
      const valid = await this.authService.isSessionValid(payload.sessionId);
      if (!valid) {
        throw new UnauthorizedException(ErrorCode.AUTH_SESSION_REVOKED, 'Session has been revoked');
      }
    }

    const user = await this.userService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }
    return user;
  }

  private async authenticateAppEndUser(
    token: string,
    hints: AppEndUserJwtHints,
  ): Promise<UserDocLike> {
    if (!hints.appDataId || !hints.sub) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid app end-user token');
    }

    await this.assertEndUserToken(token, hints.appDataId);
    await this.assertEndUserCanUseAi(hints.appDataId, hints.sub);
    const ownerUserId = await this.resolveOwnerUserId(hints.appDataId);
    if (!ownerUserId) {
      throw new UnauthorizedException(
        ErrorCode.UNAUTHORIZED,
        'App owner is not available for AI billing',
      );
    }

    const owner = await this.userService.findById(ownerUserId);
    if (!owner) {
      throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'App owner not found');
    }
    return owner;
  }

  private async assertEndUserToken(token: string, appDataId: string): Promise<void> {
    if (this.appDataClient?.isEnabled()) {
      const result = await this.appDataClient.forward(
        'GET',
        `/v1/apps/${encodeURIComponent(appDataId)}/auth/me`,
        { authorization: `Bearer ${token}` },
      );
      if (result.status >= 400) {
        throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid or expired app token');
      }
      return;
    }

    if (this.endUserAuth && this.appDataCatalog) {
      const app = await this.appDataCatalog.requireAppByAppDataId(appDataId);
      await this.endUserAuth.verifyToken(app, token);
      return;
    }

    throw new UnauthorizedException(
      ErrorCode.UNAUTHORIZED,
      'App end-user AI auth is not available in this deployment mode',
    );
  }

  private async assertEndUserCanUseAi(appDataId: string, endUserId: string): Promise<void> {
    if (this.appDataClient?.isEnabled()) {
      const endUser = await this.appDataClient.getEndUser(appDataId, endUserId);
      if (!endUser || endUser.status === 'disabled') {
        throw new ForbiddenException(
          ErrorCode.APP_DATA_USER_DISABLED,
          'User account is disabled',
        );
      }
      if (!(endUser.grants?.useAi)) {
        throw new ForbiddenException(
          ErrorCode.APP_DATA_GRANT_DENIED,
          'AI usage is not permitted for this user',
        );
      }
      return;
    }

    if (this.appDataCatalog && this.endUserGrants) {
      const app = await this.appDataCatalog.requireAppByAppDataId(appDataId);
      try {
        await this.endUserGrants.assertUseAi(app.id, endUserId);
      } catch (err) {
        if (err instanceof AppDataGrantDeniedException) {
          throw new ForbiddenException(
            ErrorCode.APP_DATA_GRANT_DENIED,
            'AI usage is not permitted for this user',
          );
        }
        throw err;
      }
      return;
    }

    throw new UnauthorizedException(
      ErrorCode.UNAUTHORIZED,
      'App end-user AI grant checks are not available in this deployment mode',
    );
  }

  private async resolveOwnerUserId(appDataId: string): Promise<string | null> {
    if (this.appDataClient?.isEnabled()) {
      try {
        const status = await this.appDataClient.getStatus(appDataId);
        const fromRemote = this.pickOwnerUserId(status.app);
        if (fromRemote) return fromRemote;

        const workspaceId = this.pickWorkspaceId(status.app);
        if (workspaceId && this.runtimeBindings) {
          const binding = await this.runtimeBindings.findByWorkspaceId(workspaceId);
          if (binding?.userId) {
            this.logger.warn(
              `App Data ${appDataId} has no ownerUserId; billing via runtime binding user ${binding.userId}`,
            );
            return binding.userId;
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to resolve App Data owner for ${appDataId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    if (this.appDataCatalog) {
      const app = await this.appDataCatalog.findByAppDataId(appDataId);
      if (app?.ownerUserId) return app.ownerUserId;
    }

    return null;
  }

  /** Microservice may return camelCase or snake_case. */
  private pickOwnerUserId(app: Record<string, unknown> | undefined): string | null {
    if (!app) return null;
    for (const key of ['ownerUserId', 'owner_user_id'] as const) {
      const value = app[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }

  private pickWorkspaceId(app: Record<string, unknown> | undefined): string | null {
    if (!app) return null;
    for (const key of ['workspaceId', 'workspace_id'] as const) {
      const value = app[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }
}
