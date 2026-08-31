import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ConversationV2SessionPermissions,
  hasConversationV2SessionPermission,
  type ConversationV2SessionPermission,
} from '../constants/conversation-v2-session-permissions';
import { CONVERSATION_V2_SESSION_PERMISSION_KEY } from '../decorators/require-conversation-session-permission.decorator';
import {
  ConversationV2SessionAccessService,
  type ConversationV2ResolvedSession,
  type ConversationV2SessionAccess,
} from '../services/conversation-v2-session-access.service';

interface RequestShape {
  user?: { id: string };
  params: { id?: string };
  conversationV2Access?: ConversationV2SessionAccess;
  conversationV2Session?: ConversationV2ResolvedSession;
}

@Injectable()
export class ConversationV2SessionAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: ConversationV2SessionAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestShape>();
    const userId = req.user?.id;
    const sessionId = req.params.id;
    if (!userId || !sessionId) throw new NotFoundException('Session not found');

    const required =
      this.reflector.getAllAndOverride<ConversationV2SessionPermission>(
        CONVERSATION_V2_SESSION_PERMISSION_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? ConversationV2SessionPermissions.SESSION_READ;

    // Resolve the full session, not just the access record: `resolve()` drops
    // the pointer, and `@CurrentConversationSession()` 404s without it. Same
    // cost — `resolve()` delegates here anyway.
    const resolved = await this.access.resolveSession(userId, sessionId);
    if (
      !resolved ||
      !hasConversationV2SessionPermission(resolved.access.permissions, required)
    ) {
      throw new NotFoundException('Session not found');
    }

    req.conversationV2Access = resolved.access;
    req.conversationV2Session = resolved;
    return true;
  }
}
