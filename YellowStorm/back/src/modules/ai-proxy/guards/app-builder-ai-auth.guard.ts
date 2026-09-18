import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { UnauthorizedException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { AuthService } from '../../auth/auth.service';
import { UserService } from '../../user/user.service';
import { UserDocument } from '../../user/schemas/user.schema';
import { AppDataClientService } from '../../app-data/services/app-data-client.service';
import { AppDataCatalogService } from '../../app-data/services/app-data-catalog.service';
import { AppDataEndUserAuthService } from '../../app-data/services/app-data-end-user-auth.service';
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
  user?: UserDocument;
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
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly authService: AuthService,
    @Optional() private readonly appDataClient?: AppDataClientService,
    @Optional() private readonly appDataCatalog?: AppDataCatalogService,
    @Optional() private readonly endUserAuth?: AppDataEndUserAuthService,
    @Optional() private readonly aiPreviewTickets?: AiPreviewTicketService,
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
  ): Promise<{ user: UserDocument; workspaceId: string }> {
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
      return this.jwtService.decode(token) as AppEndUserJwtHints | null;
    } catch {
      return null;
    }
  }

  private async authenticatePlatformAccess(token: string): Promise<UserDocument> {
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
  ): Promise<UserDocument> {
    if (!hints.appDataId || !hints.sub) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid app end-user token');
    }

    await this.assertEndUserToken(token, hints.appDataId);
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

  private async resolveOwnerUserId(appDataId: string): Promise<string | null> {
    if (this.appDataClient?.isEnabled()) {
      try {
        const status = await this.appDataClient.getStatus(appDataId);
        const owner = status.app?.ownerUserId;
        return typeof owner === 'string' ? owner : null;
      } catch {
        return null;
      }
    }

    if (this.appDataCatalog) {
      const app = await this.appDataCatalog.findByAppDataId(appDataId);
      return app?.ownerUserId ?? null;
    }

    return null;
  }
}
