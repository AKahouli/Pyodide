import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import { appDataAuditEvents } from '@modules/postgres/schema/app-data.schema';

@Injectable()
export class AppDataAuditService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async record(params: {
    appId: string;
    eventType: string;
    actorPrincipal: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(appDataAuditEvents).values({
      appId: params.appId,
      eventType: params.eventType,
      actorPrincipal: params.actorPrincipal,
      metadataJson: params.metadata ?? {},
    });
  }
}
