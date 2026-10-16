import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppBuilderSessionAccessService,
  type AppBuilderResolvedSession,
} from '../services/app-builder-session-access.service';

/**
 * Allows the conversation owner **or a user the session is shared with**.
 * Name is historical; access is resolved via AppBuilderSessionAccessService.
 */
interface RequestShape {
  user?: { id: string };
  params: { id?: string; sessionId?: string };
  appBuilderSession?: AppBuilderResolvedSession;
}

@Injectable()
export class AppBuilderOwnerGuard implements CanActivate {
  constructor(private readonly access: AppBuilderSessionAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestShape>();
    const userId = req.user?.id;
    const sessionId = req.params.id ?? req.params.sessionId;
    if (!userId || !sessionId) throw new NotFoundException('Session not found');

    const resolved = await this.access.resolveSession(userId, sessionId);
    if (!resolved) throw new NotFoundException('Session not found');

    req.appBuilderSession = resolved;
    return true;
  }
}
