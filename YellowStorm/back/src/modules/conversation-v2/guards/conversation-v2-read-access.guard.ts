import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationV2AppShareService } from '../services/conversation-v2-app-share.service';
import { ConversationV2SessionService } from '../services/conversation-v2-session.service';

interface RequestShape {
  user?: { id: string };
  params: { id?: string };
}

/**
 * Allows the session owner or a Marketplace share recipient with
 * `includeConversation` to read session metadata and events.
 */
@Injectable()
export class ConversationV2ReadAccessGuard implements CanActivate {
  constructor(
    private readonly sessions: ConversationV2SessionService,
    private readonly appShares: ConversationV2AppShareService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestShape>();
    const userId = req.user?.id;
    const sessionId = req.params.id;
    if (!userId || !sessionId) throw new NotFoundException('Session not found');

    const pointer = await this.sessions.getById(sessionId);
    if (!pointer) throw new NotFoundException('Session not found');

    const ownerId =
      typeof pointer.ownerId === 'string'
        ? pointer.ownerId
        : (pointer.ownerId as { toString(): string }).toString();

    if (ownerId === userId) return true;

    const shared = await this.appShares.hasConversationAccess(userId, sessionId);
    if (!shared) throw new NotFoundException('Session not found');
    return true;
  }
}
