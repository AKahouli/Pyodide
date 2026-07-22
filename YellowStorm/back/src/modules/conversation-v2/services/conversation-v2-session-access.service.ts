import { Injectable } from '@nestjs/common';
import {
  CONVERSATION_V2_OWNER_SESSION_PERMISSIONS,
  CONVERSATION_V2_SHARED_SESSION_PERMISSIONS,
  type ConversationV2SessionPermission,
} from '../constants/conversation-v2-session-permissions';
import { ConversationV2AppShareService } from './conversation-v2-app-share.service';
import { ConversationV2SessionService } from './conversation-v2-session.service';

export type ConversationV2ViewerRole = 'owner' | 'shared';

export interface ConversationV2SessionAccess {
  sessionId: string;
  viewerRole: ConversationV2ViewerRole;
  permissions: ConversationV2SessionPermission[];
}

@Injectable()
export class ConversationV2SessionAccessService {
  constructor(
    private readonly sessions: ConversationV2SessionService,
    private readonly appShares: ConversationV2AppShareService,
  ) {}

  async resolve(userId: string, sessionId: string): Promise<ConversationV2SessionAccess | null> {
    const pointer = await this.sessions.getById(sessionId);
    if (!pointer) return null;

    const ownerId =
      typeof pointer.ownerId === 'string'
        ? pointer.ownerId
        : (pointer.ownerId as { toString(): string }).toString();

    if (ownerId === userId) {
      return {
        sessionId,
        viewerRole: 'owner',
        permissions: [...CONVERSATION_V2_OWNER_SESSION_PERMISSIONS],
      };
    }

    const shared = await this.appShares.hasConversationAccess(userId, sessionId);
    if (!shared) return null;

    return {
      sessionId,
      viewerRole: 'shared',
      permissions: [...CONVERSATION_V2_SHARED_SESSION_PERMISSIONS],
    };
  }
}
