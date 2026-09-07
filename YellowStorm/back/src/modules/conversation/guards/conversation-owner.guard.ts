import { Inject, Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { NotFoundException, ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { CONVERSATION_STORE, type ConversationStore } from '../persistence/conversation-store';
import { isOwnedId } from '../persistence/owned-id';

interface RequestWithConversation extends Request {
  user: { _id: { toString(): string } | string; email: string };
  params: { id?: string; conversationId?: string };
}

@Injectable()
export class ConversationOwnerGuard implements CanActivate {
  constructor(@Inject(CONVERSATION_STORE) private readonly conversationStore: ConversationStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithConversation>();
    const user = request.user;

    const conversationId = request.params.id || request.params.conversationId;

    if (!conversationId || !isOwnedId(conversationId)) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Invalid conversation ID format');
    }

    const conversation = await this.conversationStore.findActiveAccessById(conversationId);

    if (!conversation) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    }

    const userId = user._id.toString();
    const isCreator = conversation.createdBy === userId;
    const isMember = conversation.memberIds.includes(userId);
    const isInvited = conversation.invitedEmails.some(
      (email) => email.toLowerCase() === user.email.toLowerCase(),
    );

    // Access logic:
    // 1. Creator and Members have full access
    // 2. Invited users can only use GET  join endpoint
    const hasFullAccess = isCreator || isMember;
    const isJoiningAction = request.method === 'POST' && request.url.endsWith('/join');
    const requestPath = request.url.split('?')[0].replace(/\/$/, '');
    const exposesActiveStream = request.method === 'GET' && requestPath.endsWith('/active-stream');
    const hasGuestAccess =
      isInvited && !exposesActiveStream && (request.method === 'GET' || isJoiningAction);

    if (!hasFullAccess && !hasGuestAccess) {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'You do not have access to this conversation',
      );
    }

    return true;
  }
}
