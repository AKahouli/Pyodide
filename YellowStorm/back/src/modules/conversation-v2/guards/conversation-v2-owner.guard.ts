import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationV2SessionService } from '../services/conversation-v2-session.service';

interface RequestShape {
  user?: { id: string };
  params: { id?: string };
}

@Injectable()
export class ConversationV2OwnerGuard implements CanActivate {
  constructor(private readonly sessions: ConversationV2SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestShape>();
    const userId = req.user?.id;
    const sessionId = req.params.id;
    if (!userId || !sessionId) throw new NotFoundException('Session not found');

    const pointer = await this.sessions.getOne(userId, sessionId);
    if (!pointer) throw new NotFoundException('Session not found');
    if (pointer.ownerId !== userId) throw new ForbiddenException('Not the owner');
    return true;
  }
}
