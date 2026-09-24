import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConversationV2SessionStatus } from '../types/conversation-v2-persistence.types';
import type { ConversationV2Event } from '../types/conversation-v2.types';
import {
  CONVERSATION_V2_SESSION_STORE,
  type ConversationV2SessionStore,
} from '../persistence/conversation-v2-session.store';

@Injectable()
export class ConversationV2PointerWriterService {
  private readonly logger = new Logger(ConversationV2PointerWriterService.name);

  constructor(
    @Inject(CONVERSATION_V2_SESSION_STORE)
    private readonly store: ConversationV2SessionStore,
  ) {}

  async apply(sessionId: string, event: ConversationV2Event): Promise<void> {
    try {
      const patch: {
        lastEventAt: Date;
        title?: string;
        status?: ConversationV2SessionStatus;
      } = { lastEventAt: new Date() };

      if (event.type === 'title') {
        patch.title = (event.payload as { title: string }).title;
      }
      if (event.type === 'message') {
        const role = (event.payload as { role?: string }).role;
        if (role === 'user') {
          patch.status = 'active';
        }
      }
      const statusForType: Record<string, ConversationV2SessionStatus | undefined> = {
        done: 'completed',
        wait: 'waiting',
        error: 'error',
      };
      const next = statusForType[event.type];
      if (next) patch.status = next;

      await this.store.applyPointerPatch(sessionId, patch);
    } catch (err) {
      this.logger.warn(
        `pointer write failed for ${sessionId}: ${(err as Error).message}`,
      );
    }
  }
}
