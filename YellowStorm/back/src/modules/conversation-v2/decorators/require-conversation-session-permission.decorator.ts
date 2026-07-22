import { SetMetadata } from '@nestjs/common';
import type { ConversationV2SessionPermission } from '../constants/conversation-v2-session-permissions';

export const CONVERSATION_V2_SESSION_PERMISSION_KEY = 'conversationV2SessionPermission';

/** Require a session-scoped permission resolved by ConversationV2SessionAccessGuard. */
export const RequireConversationSessionPermission = (permission: ConversationV2SessionPermission) =>
  SetMetadata(CONVERSATION_V2_SESSION_PERMISSION_KEY, permission);
