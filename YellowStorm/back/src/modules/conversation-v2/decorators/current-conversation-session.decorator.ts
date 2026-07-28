import { createParamDecorator, ExecutionContext, NotFoundException } from '@nestjs/common';
import type { ConversationV2ResolvedSession } from '../services/conversation-v2-session-access.service';

interface RequestWithSession {
  conversationV2Session?: ConversationV2ResolvedSession;
}

/** Session pointer resolved by ConversationV2OwnerGuard (owner or shared participant). */
export const CurrentConversationSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ConversationV2ResolvedSession => {
    const req = ctx.switchToHttp().getRequest<RequestWithSession>();
    if (!req.conversationV2Session) {
      throw new NotFoundException('Session not found');
    }
    return req.conversationV2Session;
  },
);
