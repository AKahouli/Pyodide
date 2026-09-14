import { randomBytes } from 'crypto';
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
} from '@modules/postgres/schema/app-data.schema';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataIdentifierService } from './app-data-identifier.service';
import { AppDataAuditService } from './app-data-audit.service';
import { quoteIdent, tenantSchemaName } from '../utils/app-data-sql.util';

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
   * Handles race conditions: if two concurrent requests try to provision the
   * same workspace, the second one catches the unique constraint violation
   * and returns the existing app.
   */
  async provisionDev(params: {
    workspaceId: string;
    ownerUserId: string;
    actorPrincipal?: string;
  }): Promise<{ appDataId: string; schemaName: string; currentVersion: number }> {
    this.assertEnabled();
    const existing = await this.catalog.findByWorkspaceId(params.workspaceId);
    if (existing) {
      return this.completeProvisionIfNeeded(existing, params.workspaceId, params.actorPrincipal);
    }

    const appDataId = this.identifiers.generate();
    const devSchema = tenantSchemaName(appDataId, 'dev');
    const prodSchema = tenantSchemaName(appDataId, 'prod');
    const jwtSecret = randomBytes(32).toString('hex');
    const endUserAuthEnabled = this.config.get<boolean>('appData.endUserAuthEnabled', true);

    try {
      const [app] = await this.db
        .insert(appDataApps)
        .values({
          appDataId,
          workspaceId: params.workspaceId,
          ownerUserId: params.ownerUserId,
          lifecycleState: 'active',
          jwtSecret,
          endUserAuthEnabled,
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
    } catch (err) {
      // Race condition: another request inserted the same workspaceId between
      // our findByWorkspaceId check and this insert. Fetch and return the existing app.
      const code = (err as { code?: string } | undefined)?.code;
      if (code === '23505') {
        const raceExisting = await this.catalog.findByWorkspaceId(params.workspaceId);
        if (raceExisting) {
          this.logger.log(
            `Provision race condition resolved for workspaceId=${params.workspaceId}, using existing appDataId=${raceExisting.appDataId}`,
          );
          return this.completeProvisionIfNeeded(raceExisting, params.workspaceId, params.actorPrincipal);
        }
      }
      throw err;
    }
  }

  private async completeProvisionIfNeeded(
    app: import('@modules/postgres/schema/app-data.schema').AppDataAppRow,
    workspaceId: string,
    actorPrincipal?: string,
  ): Promise<{ appDataId: string; schemaName: string; currentVersion: number }> {
    const env = await this.catalog.getEnvironment(app.id, 'dev');
    if (env?.provisionedAt) {
      return {
        appDataId: app.appDataId,
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
      appDataId: app.appDataId,
      schemaName: env!.schemaName,
      currentVersion: env!.currentVersion,
    };
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

  private async createPhysicalSchema(schemaName: string): Promise<void> {
    const timeoutMs = this.config.get<number>('appData.statementTimeoutMs', 30_000);
    const client = await this.pool.connect();
    try {
      await client.query('SET statement_timeout = $1', [timeoutMs]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schemaName)}`);
    } finally {
      client.release();
    }
  }
}
