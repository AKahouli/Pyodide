import type { AppBuilderEventTypeName } from '../types/app-builder-persistence.types';
import type { AppBuilderEvent as WireEvent } from '../types/app-builder.types';


export interface AppendResult {
  sequence: number;
  inserted: boolean;
}

export interface AppBuilderEventRecord {
  id: string;
  sessionId: string;
  sequence: number;
  eventId: string;
  type: AppBuilderEventTypeName;
  emittedAt: number;
  payload: Record<string, unknown>;
  modelId: string | null;
  createdAt: Date;
}

export interface AppBuilderEventStore {
  append(sessionId: string, event: WireEvent): Promise<AppendResult>;
  listSince(sessionId: string, since: number, limit: number): Promise<AppBuilderEventRecord[]>;
  listByType(sessionId: string, type: AppBuilderEventTypeName): Promise<AppBuilderEventRecord[]>;
  tagModel(sessionId: string, eventId: string, modelId: string): Promise<void>;
}
