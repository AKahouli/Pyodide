import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { DRIZZLE_DB, PG_POOL } from '@modules/postgres/postgres.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import {
  appDataApps,
  appDataEnvironments,
  appDataPolicies,
} from '@modules/postgres/schema/app-data.schema';
import type { AppDataEnvironment } from '../constants/app-data.constants';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import type { AppDataPolicyDocument } from '../constants/app-data.types';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataIdentifierService } from './app-data-identifier.service';
import { AppDataAuditService } from './app-data-audit.service';
import { quoteIdent, tenantSchemaName } from '../utils/app-data-sql.util';

const DEFAULT_OWNER_POLICY: AppDataPolicyDocument = {};

@Injectable()
export class AppDataProvisioningService {
  private readonly logger = new Logger(AppDataProvisioningService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly identifiers: AppDataIdentifierService,
    private readonly audit: AppDataAuditService,
  ) {}

  assertEnabled(): void {
    if (!this.catalog.isEnabled()) {
      throw new AppDataException(
        AppDataErrorCode.DISABLED,
        'App Data is disabled on this host',
      );
    }
  }

  /**
   * Idempotently register the workspace and provision DEV schema version 0.
   */
  async provisionDev(params: {
    workspaceId: string;
    ownerUserId: string;
    actorPrincipal?: string;
  }): Promise<{ appDataId: string; schemaName: string; currentVersion: number }> {
    this.assertEnabled();
    const existing = await this.catalog.findByWorkspaceId(params.workspaceId);
    if (existing) {
      const env = await this.catalog.getEnvironment(existing.id, 'dev');
      if (env?.provisionedAt) {
        return {
          appDataId: existing.appDataId,
          schemaName: env.schemaName,
          currentVersion: env.currentVersion,
        };
      }
      await this.createPhysicalSchema(env!.schemaName);
      await this.db
        .update(appDataEnvironments)
        .set({ provisionedAt: new Date(), updatedAt: new Date() })
        .where(eq(appDataEnvironments.id, env!.id));
      return {
        appDataId: existing.appDataId,
        schemaName: env!.schemaName,
        currentVersion: env!.currentVersion,
      };
    }

    const appDataId = this.identifiers.generate();
    const devSchema = tenantSchemaName(appDataId, 'dev');
    const prodSchema = tenantSchemaName(appDataId, 'prod');

    const [app] = await this.db
      .insert(appDataApps)
      .values({
        appDataId,
        workspaceId: params.workspaceId,
        ownerUserId: params.ownerUserId,
        lifecycleState: 'active',
      })
      .returning();

    await this.db.insert(appDataEnvironments).values([
      {
        appId: app.id,
        environment: 'dev',
        schemaName: devSchema,
        currentVersion: 0,
        provisionedAt: null,
      },
      {
        appId: app.id,
        environment: 'prod',
        schemaName: prodSchema,
        currentVersion: 0,
        provisionedAt: null,
      },
    ]);

    await this.createPhysicalSchema(devSchema);
    const devEnvRow = await this.catalog.getEnvironment(app.id, 'dev');
    if (devEnvRow) {
      await this.db
        .update(appDataEnvironments)
        .set({ provisionedAt: new Date(), updatedAt: new Date() })
        .where(eq(appDataEnvironments.id, devEnvRow.id));
    }

    await this.audit.record({
      appId: app.id,
      eventType: 'provision_dev',
      actorPrincipal: params.actorPrincipal ?? 'system',
      metadata: { workspaceId: params.workspaceId, schemaName: devSchema },
    });

    this.logger.log(
      `Provisioned app data appDataId=${appDataId} workspaceId=${params.workspaceId} devSchema=${devSchema}`,
    );

    return { appDataId, schemaName: devSchema, currentVersion: 0 };
  }

  async provisionProdIfNeeded(appId: string): Promise<void> {
    this.assertEnabled();
    const env = await this.catalog.getEnvironment(appId, 'prod');
    if (!env) {
      throw new AppDataException(AppDataErrorCode.NOT_PROVISIONED, 'PROD environment row missing');
    }
    if (env.provisionedAt) {
      return;
    }
    await this.createPhysicalSchema(env.schemaName);
    await this.db
      .update(appDataEnvironments)
      .set({ provisionedAt: new Date(), updatedAt: new Date() })
      .where(eq(appDataEnvironments.id, env.id));
    await this.audit.record({
      appId,
      eventType: 'provision_prod',
      actorPrincipal: 'system',
      metadata: { schemaName: env.schemaName },
    });
  }

  async seedDefaultPolicies(appId: string, environment: AppDataEnvironment): Promise<void> {
    for (const [tableName, policy] of Object.entries(DEFAULT_OWNER_POLICY)) {
      await this.db.insert(appDataPolicies).values({
        appId,
        environment,
        tableName,
        policyJson: policy,
      });
    }
  }

  private async createPhysicalSchema(schemaName: string): Promise<void> {
    const timeoutMs = this.config.get<number>('appData.statementTimeoutMs', 30_000);
    const client = await this.pool.connect();
    try {
      await client.query(`SET statement_timeout = ${timeoutMs}`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schemaName)}`);
    } finally {
      client.release();
    }
  }
}
