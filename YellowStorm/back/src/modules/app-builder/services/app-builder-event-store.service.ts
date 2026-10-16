import { Injectable,  Logger } from '@nestjs/common';
import type { AppBuilderEventTypeName } from '../types/app-builder-persistence.types';
import type { AppBuilderEvent as WireEvent } from '../types/app-builder.types';
import {
  type AppendResult,  
  type AppBuilderEventRecord,  
} from '../persistence/app-builder-event.store';
import { PgAppBuilderEventStore } from '../persistence/postgres/pg-app-builder-event.store';

export type { AppendResult };
export type PersistedEventRow = AppBuilderEventRecord;

@Injectable()
export class AppBuilderEventStoreService {
  private readonly logger = new Logger(AppBuilderEventStoreService.name);

  constructor(
    private readonly store: PgAppBuilderEventStore,
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
    type: AppBuilderEventTypeName,
  ): Promise<PersistedEventRow[]> {
    return this.store.listByType(sessionId, type);
  }

  async tagModel(sessionId: string, eventId: string, modelId: string): Promise<void> {
    await this.store.tagModel(sessionId, eventId, modelId);
  }
}
