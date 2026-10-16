import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AppBuilderSessionPermissions,
  hasAppBuilderSessionPermission,
  type AppBuilderSessionPermission,
} from '../constants/app-builder-session-permissions';
import { APP_BUILDER_SESSION_PERMISSION_KEY } from '../decorators/require-app-builder-session-permission.decorator';
import {
  AppBuilderSessionAccessService,
  type AppBuilderResolvedSession,
  type AppBuilderSessionAccess,
} from '../services/app-builder-session-access.service';

interface RequestShape {
  user?: { id: string };
  params: { id?: string };
  appBuilderAccess?: AppBuilderSessionAccess;
  appBuilderSession?: AppBuilderResolvedSession;
}

@Injectable()
export class AppBuilderSessionAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AppBuilderSessionAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestShape>();
    const userId = req.user?.id;
    const sessionId = req.params.id;
    if (!userId || !sessionId) throw new NotFoundException('Session not found');

    const required =
      this.reflector.getAllAndOverride<AppBuilderSessionPermission>(
        APP_BUILDER_SESSION_PERMISSION_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? AppBuilderSessionPermissions.SESSION_READ;

    // Resolve the full session, not just the access record: `resolve()` drops
    // the pointer, and `@CurrentAppBuilderSession()` 404s without it. Same
    // cost — `resolve()` delegates here anyway.
    const resolved = await this.access.resolveSession(userId, sessionId);
    if (
      !resolved ||
      !hasAppBuilderSessionPermission(resolved.access.permissions, required)
    ) {
      throw new NotFoundException('Session not found');
    }

    req.appBuilderAccess = resolved.access;
    req.appBuilderSession = resolved;
    return true;
  }
}
