import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and } from 'drizzle-orm';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import {
  appDataApps,
  appDataEnvironments,
  type AppDataAppRow,
  type AppDataEnvironmentRow,
} from '@modules/postgres/schema/app-data.schema';
import type { AppDataEnvironment, AppDataLifecycleState } from '../constants/app-data.constants';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import type { AppDataStatus } from '../constants/app-data.types';
import { tenantSchemaName } from '../utils/app-data-sql.util';

@Injectable()
export class AppDataCatalogService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<boolean>('appData.enabled', false);
  }

  async findByWorkspaceId(workspaceId: string): Promise<AppDataAppRow | null> {
    const rows = await this.db
      .select()
      .from(appDataApps)
      .where(eq(appDataApps.workspaceId, workspaceId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByAppDataId(appDataId: string): Promise<AppDataAppRow | null> {
    const rows = await this.db
      .select()
      .from(appDataApps)
      .where(eq(appDataApps.appDataId, appDataId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getEnvironment(
    appId: string,
    environment: AppDataEnvironment,
  ): Promise<AppDataEnvironmentRow | null> {
    const rows = await this.db
      .select()
      .from(appDataEnvironments)
      .where(and(eq(appDataEnvironments.appId, appId), eq(appDataEnvironments.environment, environment)))
      .limit(1);
    return rows[0] ?? null;
  }

  async requireAppByWorkspace(workspaceId: string): Promise<AppDataAppRow> {
    const app = await this.findByWorkspaceId(workspaceId);
    if (!app) {
      throw new AppDataException(
        AppDataErrorCode.NOT_PROVISIONED,
        `No app data registered for workspace ${workspaceId}`,
      );
    }
    return app;
  }

  async requireAppByAppDataId(appDataId: string): Promise<AppDataAppRow> {
    const app = await this.findByAppDataId(appDataId);
    if (!app) {
      throw new AppDataException(
        AppDataErrorCode.NOT_PROVISIONED,
        `Unknown appDataId: ${appDataId}`,
      );
    }
    return app;
  }

  async getStatus(workspaceId: string): Promise<AppDataStatus> {
    const enabled = this.isEnabled();
    const app = await this.findByWorkspaceId(workspaceId);
    if (!app) {
      return {
        enabled,
        appDataId: null,
        workspaceId,
        lifecycleState: null,
        dev: { provisioned: false, schemaName: null, currentVersion: null },
        prod: { provisioned: false, schemaName: null, currentVersion: null },
      };
    }
    const dev = await this.getEnvironment(app.id, 'dev');
    const prod = await this.getEnvironment(app.id, 'prod');
    return {
      enabled,
      appDataId: app.appDataId,
      workspaceId,
      lifecycleState: app.lifecycleState,
      dev: {
        provisioned: !!dev?.provisionedAt,
        schemaName: dev?.schemaName ?? tenantSchemaName(app.appDataId, 'dev'),
        currentVersion: dev?.currentVersion ?? null,
      },
      prod: {
        provisioned: !!prod?.provisionedAt,
        schemaName: prod?.schemaName ?? tenantSchemaName(app.appDataId, 'prod'),
        currentVersion: prod?.currentVersion ?? null,
      },
    };
  }

  async updateLifecycle(appId: string, state: AppDataLifecycleState): Promise<void> {
    await this.db
      .update(appDataApps)
      .set({ lifecycleState: state, updatedAt: new Date() })
      .where(eq(appDataApps.id, appId));
  }
}
