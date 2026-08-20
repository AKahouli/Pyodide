import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import { appDataReleaseBindings } from '@modules/postgres/schema/app-data.schema';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataAuditService } from './app-data-audit.service';

@Injectable()
export class AppDataReleaseBindingService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly catalog: AppDataCatalogService,
    private readonly audit: AppDataAuditService,
  ) {}

  async bindRevision(params: {
    workspaceId: string;
    revisionId: string;
  }): Promise<{ requiredSchemaVersion: number | null }> {
    const app = await this.catalog.findByWorkspaceId(params.workspaceId);
    if (!app) {
      return { requiredSchemaVersion: null };
    }
    const dev = await this.catalog.getEnvironment(app.id, 'dev');
    const version = dev?.currentVersion ?? null;

    await this.db
      .insert(appDataReleaseBindings)
      .values({
        workspaceId: params.workspaceId,
        revisionId: params.revisionId,
        appId: app.id,
        requiredSchemaVersion: version,
      })
      .onConflictDoUpdate({
        target: [appDataReleaseBindings.workspaceId, appDataReleaseBindings.revisionId],
        set: { requiredSchemaVersion: version },
      });

    await this.audit.record({
      appId: app.id,
      eventType: 'release_binding',
      actorPrincipal: 'system',
      metadata: { revisionId: params.revisionId, requiredSchemaVersion: version },
    });

    return { requiredSchemaVersion: version };
  }

  async getBinding(workspaceId: string, revisionId: string) {
    const rows = await this.db
      .select()
      .from(appDataReleaseBindings)
      .where(
        and(
          eq(appDataReleaseBindings.workspaceId, workspaceId),
          eq(appDataReleaseBindings.revisionId, revisionId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
