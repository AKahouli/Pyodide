import { Injectable,  Logger } from '@nestjs/common';
import type { ConversationV2EventTypeName } from '../types/conversation-v2-persistence.types';
import type { ConversationV2Event as WireEvent } from '../types/conversation-v2.types';
import {
  type AppendResult,  
  type ConversationV2EventRecord,  
} from '../persistence/conversation-v2-event.store';
import { PgConversationV2EventStore } from '../persistence/postgres/pg-conversation-v2-event.store';

export type { AppendResult };
export type PersistedEventRow = ConversationV2EventRecord;

@Injectable()
export class ConversationV2EventStoreService {
  private readonly logger = new Logger(ConversationV2EventStoreService.name);

  constructor(
    private readonly store: PgConversationV2EventStore,
  ) {}

  async append(sessionId: string, event: WireEvent): Promise<AppendResult> {
    return this.store.append(sessionId, event);
  }

  async listSince(
    sessionId: string,
    since: number,
    limit: number,
  ): Promise<PersistedEventRow[]> {
    return this.store.listSince(sessionId, since, limit);
  }

  async listByType(
    sessionId: string,
    type: ConversationV2EventTypeName,
  ): Promise<PersistedEventRow[]> {
    return this.store.listByType(sessionId, type);
  }

  async tagModel(sessionId: string, eventId: string, modelId: string): Promise<void> {
    await this.store.tagModel(sessionId, eventId, modelId);
  }
}
