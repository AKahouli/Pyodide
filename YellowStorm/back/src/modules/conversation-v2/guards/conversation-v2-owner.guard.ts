import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationV2SessionAccessService,
  type ConversationV2ResolvedSession,
} from '../services/conversation-v2-session-access.service';

/**
 * Allows the conversation owner **or a user the session is shared with**.
 * Name is historical; access is resolved via ConversationV2SessionAccessService.
 */
interface RequestShape {
  user?: { id: string };
  params: { id?: string; sessionId?: string };
  conversationV2Session?: ConversationV2ResolvedSession;
}

@Injectable()
export class ConversationV2OwnerGuard implements CanActivate {
  constructor(private readonly access: ConversationV2SessionAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestShape>();
    const userId = req.user?.id;
    const sessionId = req.params.id ?? req.params.sessionId;
    if (!userId || !sessionId) throw new NotFoundException('Session not found');

    const resolved = await this.access.resolveSession(userId, sessionId);
    if (!resolved) throw new NotFoundException('Session not found');

    req.conversationV2Session = resolved;
    return true;
  }
}
