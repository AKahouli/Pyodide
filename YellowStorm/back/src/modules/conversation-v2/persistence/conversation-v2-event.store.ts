import type { ConversationV2EventTypeName } from '../types/conversation-v2-persistence.types';
import type { ConversationV2Event as WireEvent } from '../types/conversation-v2.types';


export interface AppendResult {
  sequence: number;
  inserted: boolean;
}

export interface ConversationV2EventRecord {
  id: string;
  sessionId: string;
  sequence: number;
  eventId: string;
  type: ConversationV2EventTypeName;
  emittedAt: number;
  payload: Record<string, unknown>;
  modelId: string | null;
  createdAt: Date;
}

export interface ConversationV2EventStore {
  append(sessionId: string, event: WireEvent): Promise<AppendResult>;
  listSince(sessionId: string, since: number, limit: number): Promise<ConversationV2EventRecord[]>;
  listByType(sessionId: string, type: ConversationV2EventTypeName): Promise<ConversationV2EventRecord[]>;
  tagModel(sessionId: string, eventId: string, modelId: string): Promise<void>;
}
