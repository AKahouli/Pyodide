import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import { appDataSchemaVersions } from '@modules/postgres/schema/app-data.schema';
import type { AppDataEnvironment } from '../constants/app-data.constants';
import {
  AppDataErrorCode,
  AppDataException,
  AppDataVersionConflictException,
} from '../constants/app-data.errors';
import type { AppDataMigrationPlan, AppDataSchemaManifest } from '../constants/app-data.types';
import {
  formatDefault,
  pgTypeForColumn,
  quoteIdent,
  validateManifest,
} from '../utils/app-data-sql.util';
import { AppDataAdvisoryLockService } from './app-data-advisory-lock.service';
import { AppDataAuditService } from './app-data-audit.service';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataPolicyService } from './app-data-policy.service';
import { AppDataSchemaDiffService } from './app-data-schema-diff.service';

@Injectable()
export class AppDataMigrationService {
  private readonly logger = new Logger(AppDataMigrationService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly diff: AppDataSchemaDiffService,
    private readonly policies: AppDataPolicyService,
    private readonly locks: AppDataAdvisoryLockService,
    private readonly audit: AppDataAuditService,
  ) {}

  async getCurrentManifest(
    appId: string,
    environment: AppDataEnvironment,
  ): Promise<AppDataSchemaManifest> {
    const env = await this.catalog.getEnvironment(appId, environment);
    const version = env?.currentVersion ?? 0;
    if (version === 0) {
      return this.diff.emptyAtVersion(0);
    }
    const rows = await this.db
      .select()
      .from(appDataSchemaVersions)
      .where(
        and(
          eq(appDataSchemaVersions.appId, appId),
          eq(appDataSchemaVersions.environment, environment),
          eq(appDataSchemaVersions.version, version),
        ),
      )
      .limit(1);
    return (rows[0]?.manifestJson as AppDataSchemaManifest) ?? this.diff.emptyAtVersion(version);
  }

  async applyPlan(params: {
    appId: string;
    appDataId: string;
    workspaceId: string;
    environment: AppDataEnvironment;
    schemaName: string;
    plan: AppDataMigrationPlan;
    targetManifest: AppDataSchemaManifest;
    manifestHash: string;
    expectedVersion: number;
    confirmDestructive?: boolean;
    toolCallId?: string;
    actorPrincipal?: string;
  }): Promise<{ version: number; applied: boolean }> {
    if (params.environment === 'prod' && params.plan.hasDestructive) {
      throw new AppDataException(
        AppDataErrorCode.DESTRUCTIVE_BLOCKED,
        'Destructive migrations are blocked on PROD',
      );
    }
    if (params.plan.hasDestructive && !params.confirmDestructive) {
      throw new AppDataException(
        AppDataErrorCode.DESTRUCTIVE_BLOCKED,
        'Destructive migration requires confirmDestructive=true',
      );
    }

    return this.locks.withLock(params.appDataId, params.environment, async (client) => {
      const env = await this.catalog.getEnvironment(params.appId, params.environment);
      if (!env) {
        throw new AppDataException(AppDataErrorCode.NOT_PROVISIONED, 'Environment not found');
      }
      if (env.currentVersion !== params.expectedVersion) {
        throw new AppDataVersionConflictException(params.expectedVersion, env.currentVersion);
      }
      if (params.plan.operations.length === 0) {
        return { version: env.currentVersion, applied: false };
      }

      const timeoutMs = this.config.get<number>('appData.statementTimeoutMs', 30_000);
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        String(Math.max(1, Math.floor(Number(timeoutMs)))),
      ]);
      await client.query(`SET LOCAL search_path TO ${quoteIdent(params.schemaName)}, public`);

      for (const op of params.plan.operations) {
        await this.executeOperation(client, op, params.targetManifest);
      }

      const nextVersion = params.targetManifest.version;
      await client.query(
        `INSERT INTO app_data.schema_versions (app_id, environment, version, manifest_hash, manifest_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          params.appId,
          params.environment,
          nextVersion,
          params.manifestHash,
          JSON.stringify(params.targetManifest),
        ],
      );
      await client.query(
        `INSERT INTO app_data.migrations
           (app_id, environment, from_version, to_version, plan_json, classification, tool_call_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          params.appId,
          params.environment,
          params.plan.fromVersion,
          params.plan.toVersion,
          JSON.stringify(params.plan),
          this.diff.overallClassification(params.plan),
          params.toolCallId ?? null,
        ],
      );
      await client.query(
        `UPDATE app_data.environments SET current_version = $1, updated_at = NOW() WHERE id = $2`,
        [nextVersion, env.id],
      );

      await this.audit.record({
        appId: params.appId,
        eventType: 'schema_apply',
        actorPrincipal: params.actorPrincipal ?? 'mcp',
        metadata: {
          environment: params.environment,
          fromVersion: params.plan.fromVersion,
          toVersion: params.plan.toVersion,
          destructive: params.plan.hasDestructive,
        },
      });

      this.logger.log(
        `Applied schema migration appDataId=${params.appDataId} env=${params.environment} v${params.plan.fromVersion}->v${params.plan.toVersion}`,
      );

      if (params.environment === 'dev') {
        const createdTables = params.plan.operations
          .filter((op) => op.kind === 'create_table')
          .map((op) => op.table);
        if (createdTables.length > 0) {
          await this.policies.ensureDevDefaultPolicies({
            workspaceId: params.workspaceId,
            tableNames: createdTables,
            actorPrincipal: params.actorPrincipal ?? 'schema_apply',
          });
        }
      }

      return { version: params.targetManifest.version, applied: true };
    });
  }

  private async executeOperation(
    client: import('pg').PoolClient,
    op: AppDataMigrationPlan['operations'][number],
    target: AppDataSchemaManifest,
  ): Promise<void> {
    const tableQ = quoteIdent(op.table);
    switch (op.kind) {
      case 'create_table': {
        const def = target.tables[op.table];
        const parts: string[] = [];
        for (const [colName, colDef] of Object.entries(def.columns)) {
          parts.push(this.columnSql(colName, colDef));
        }
        await client.query(`CREATE TABLE IF NOT EXISTS ${tableQ} (${parts.join(', ')})`);
        break;
      }
      case 'drop_table':
        await client.query(`DROP TABLE IF EXISTS ${tableQ}`);
        break;
      case 'add_column': {
        if (!op.column || !op.columnDef) {
          throw new AppDataException(
            AppDataErrorCode.INVALID_MANIFEST,
            `add_column on ${op.table} is missing column definition`,
          );
        }
        await client.query(
          `ALTER TABLE ${tableQ} ADD COLUMN IF NOT EXISTS ${this.columnSql(op.column, op.columnDef)}`,
        );
        break;
      }
      case 'drop_column':
        if (!op.column) {
          throw new AppDataException(
            AppDataErrorCode.INVALID_MANIFEST,
            `drop_column on ${op.table} is missing column name`,
          );
        }
        await client.query(`ALTER TABLE ${tableQ} DROP COLUMN IF EXISTS ${quoteIdent(op.column)}`);
        break;
      case 'alter_column_nullable':
        if (!op.column || !op.columnDef) {
          throw new AppDataException(
            AppDataErrorCode.INVALID_MANIFEST,
            `alter_column_nullable on ${op.table} is missing column definition`,
          );
        }
        await client.query(
          `ALTER TABLE ${tableQ} ALTER COLUMN ${quoteIdent(op.column)} ${
            op.columnDef.nullable === false ? 'SET NOT NULL' : 'DROP NOT NULL'
          }`,
        );
        break;
      default:
        throw new AppDataException(
          AppDataErrorCode.INVALID_MANIFEST,
          `Unsupported migration operation: ${String((op as { kind?: string }).kind)}`,
        );
    }
  }

  private columnSql(name: string, def: import('../constants/app-data.types').AppDataColumnDef): string {
    const parts = [quoteIdent(name), pgTypeForColumn(def.type)];
    if (def.primaryKey) parts.push('PRIMARY KEY');
    if (def.unique) parts.push('UNIQUE');
    if (def.nullable === false) parts.push('NOT NULL');
    const d = formatDefault(def);
    if (d !== null) parts.push(`DEFAULT ${d}`);
    return parts.join(' ');
  }

  async listVersions(appId: string, environment: AppDataEnvironment, limit = 20) {
    return this.db
      .select()
      .from(appDataSchemaVersions)
      .where(and(eq(appDataSchemaVersions.appId, appId), eq(appDataSchemaVersions.environment, environment)))
      .orderBy(desc(appDataSchemaVersions.version))
      .limit(limit);
  }
}
