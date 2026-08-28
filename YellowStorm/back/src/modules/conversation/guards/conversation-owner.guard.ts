import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';
import { NotFoundException, ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

interface RequestWithConversation extends Request {
  user: { _id: Types.ObjectId; email: string };
  params: { id?: string; conversationId?: string };
  conversation?: ConversationDocument;
}

@Injectable()
export class ConversationOwnerGuard implements CanActivate {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithConversation>();
    const user = request.user;

    const conversationId = request.params.id || request.params.conversationId;

    if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Invalid conversation ID format',
      );
    }

    const conversation = await this.conversationModel
      .findOne({
        _id: conversationId,
        initializationStatus: { $nin: ['pending', 'seeding', 'cleanup_pending'] },
      })
      .lean()
      .exec();

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    const isCreator = conversation.createdBy.toString() === user._id.toString();
    const isMember = conversation.groupMeta?.members.some(
      (m) => m.userId.toString() === user._id.toString()
    );
    const isInvited = conversation.groupMeta?.invitedUsers?.some(
      (u) => u.email.toLowerCase() === user.email.toLowerCase()
    ) || false;

    // Access logic:
    // 1. Creator and Members have full access
    // 2. Invited users can only use GET  join endpoint
    const hasFullAccess = isCreator || isMember;
    const isJoiningAction = request.method === 'POST' && request.url.endsWith('/join');
    const requestPath = request.url.split('?')[0].replace(/\/$/, '');
    const exposesActiveStream = request.method === 'GET' && requestPath.endsWith('/active-stream');
    const hasGuestAccess = isInvited && !exposesActiveStream && (request.method === 'GET' || isJoiningAction);

    if (!hasFullAccess && !hasGuestAccess) {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'You do not have access to this conversation',
      );
    }

    return true;
  }
}
