import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppDataEnvironment } from '../constants/app-data.constants';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import type { AppDataSchemaManifest } from '../constants/app-data.types';
import { validateManifest } from '../utils/app-data-sql.util';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataMigrationService } from './app-data-migration.service';
import { AppDataSchemaDiffService } from './app-data-schema-diff.service';

@Injectable()
export class AppDataSchemaService {
  constructor(
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly diff: AppDataSchemaDiffService,
    private readonly migrations: AppDataMigrationService,
  ) {}

  private limits() {
    return {
      maxTables: this.config.get<number>('appData.maxTables', 32),
      maxColumns: this.config.get<number>('appData.maxColumns', 64),
    };
  }

  async getSchema(workspaceId: string, environment: AppDataEnvironment = 'dev') {
    const app = await this.catalog.requireAppByWorkspace(workspaceId);
    const env = await this.catalog.getEnvironment(app.id, environment);
    const manifest = await this.migrations.getCurrentManifest(app.id, environment);
    return {
      appDataId: app.appDataId,
      environment,
      currentVersion: env?.currentVersion ?? 0,
      manifest,
      manifestHash: this.diff.hashManifest(manifest),
    };
  }

  async planSchema(params: {
    workspaceId: string;
    environment: AppDataEnvironment;
    manifest: AppDataSchemaManifest;
    expectedVersion: number;
  }) {
    validateManifest(params.manifest, this.limits());
    const app = await this.catalog.requireAppByWorkspace(params.workspaceId);
    const env = await this.catalog.getEnvironment(app.id, params.environment);
    const currentVersion = env?.currentVersion ?? 0;
    if (currentVersion !== params.expectedVersion) {
      throw new AppDataException(
        AppDataErrorCode.VERSION_CONFLICT,
        `Expected version ${params.expectedVersion}, actual ${currentVersion}`,
      );
    }
    const current = await this.migrations.getCurrentManifest(app.id, params.environment);
    const target: AppDataSchemaManifest = {
      version: params.manifest.version,
      tables: params.manifest.tables,
    };
    if (target.version <= current.version) {
      throw new AppDataException(
        AppDataErrorCode.PROD_DOWNGRADE_BLOCKED,
        'Manifest version must increase',
      );
    }
    const plan = this.diff.planMigration(current, target);
    return {
      appDataId: app.appDataId,
      environment: params.environment,
      plan,
      manifestHash: this.diff.hashManifest(target),
      targetManifest: target,
    };
  }

  async applySchema(params: {
    workspaceId: string;
    environment: AppDataEnvironment;
    manifest: AppDataSchemaManifest;
    expectedVersion: number;
    confirmDestructive?: boolean;
    toolCallId?: string;
    actorPrincipal?: string;
  }) {
    const planned = await this.planSchema(params);
    const env = await this.catalog.getEnvironment(
      (await this.catalog.requireAppByWorkspace(params.workspaceId)).id,
      params.environment,
    );
    if (!env?.schemaName) {
      throw new AppDataException(AppDataErrorCode.NOT_PROVISIONED, 'Schema not provisioned');
    }
    const app = await this.catalog.requireAppByWorkspace(params.workspaceId);
    return this.migrations.applyPlan({
      appId: app.id,
      appDataId: app.appDataId,
      workspaceId: params.workspaceId,
      environment: params.environment,
      schemaName: env.schemaName,
      plan: planned.plan,
      targetManifest: planned.targetManifest,
      manifestHash: planned.manifestHash,
      expectedVersion: params.expectedVersion,
      confirmDestructive: params.confirmDestructive,
      toolCallId: params.toolCallId,
      actorPrincipal: params.actorPrincipal,
    });
  }
}
