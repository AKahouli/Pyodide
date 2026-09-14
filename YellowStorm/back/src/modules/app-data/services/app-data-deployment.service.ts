import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import type { AppDataRuntimeEnv } from '../constants/app-data.types';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataMigrationService } from './app-data-migration.service';
import { AppDataPolicyService } from './app-data-policy.service';
import { AppDataProvisioningService } from './app-data-provisioning.service';
import { AppDataReleaseBindingService } from './app-data-release-binding.service';
import { AppDataSchemaDiffService } from './app-data-schema-diff.service';
import { AppDataSchemaService } from './app-data-schema.service';

@Injectable()
export class AppDataDeploymentService {
  private readonly logger = new Logger(AppDataDeploymentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly provisioning: AppDataProvisioningService,
    private readonly bindings: AppDataReleaseBindingService,
    private readonly migrations: AppDataMigrationService,
    private readonly schema: AppDataSchemaService,
    private readonly diff: AppDataSchemaDiffService,
    private readonly policies: AppDataPolicyService,
  ) {}

  /**
   * Generated apps NEVER talk to this backend for App Data: the public CRUD /
   * auth / invite surface lives in the app-data microservice in every mode.
   * So even in local mode (APP_DATA_REMOTE=false) the URL points at the
   * microservice — local microservice for dev/preview, deployed microservice
   * for PROD — never at the removed monolith /api/v1/app-data/public/... path.
   */
  resolvePublicUrl(appDataId: string, environment: 'dev' | 'prod'): string {
    const devBase = (
      this.config.get<string>('appData.remotePublicBaseUrl') || 'http://localhost:8443'
    ).replace(/\/$/, '');
    if (environment === 'dev') {
      return `${devBase}/v1/apps/${appDataId}/dev`;
    }

    // PROD deployed apps are served over HTTPS. An https page cannot call an
    const prodBase = (
      this.config.get<string>('appData.remotePublicBaseUrlProd') || ''
    ).trim().replace(/\/$/, '');
    if (!prodBase) {
      if (process.env.NODE_ENV === 'production') {
        throw new AppDataException(
          AppDataErrorCode.DEPLOY_CONFIG_MISSING,
          'APP_DATA_REMOTE_PUBLIC_BASE_URL_PROD is required when deploying App Data apps in production',
        );
      }
      return `${devBase}/v1/apps/${appDataId}/prod`;
    }
    return `${prodBase}/v1/apps/${appDataId}/prod`;
  }

  buildRuntimeEnv(appDataId: string, environment: 'dev' | 'prod'): AppDataRuntimeEnv {
    return {
      appDataId,
      environment,
      publicUrl: this.resolvePublicUrl(appDataId, environment),
    };
  }

  async getRuntimeEnvForWorkspace(
    workspaceId: string,
    environment: 'dev' | 'prod' = 'dev',
  ): Promise<AppDataRuntimeEnv | null> {
    if (!this.catalog.isEnabled()) return null;
    try {
      const app = await this.catalog.findByWorkspaceId(workspaceId);
      if (!app) return null;
      return this.buildRuntimeEnv(app.appDataId, environment);
    } catch (err) {
      this.logger.warn(
        `App Data catalog lookup failed for workspaceId=${workspaceId}; runtime ticket proceeds without appDataRuntimeEnv`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  /**
   * Prepare PROD schema up to the revision-bound version (schema only, no row copy).
   */
  async prepareProduction(workspaceId: string, revisionId: string): Promise<AppDataRuntimeEnv> {
    this.provisioning.assertEnabled();
    const app = await this.catalog.requireAppByWorkspace(workspaceId);
    await this.provisioning.provisionProdIfNeeded(app.id);

    const binding =
      (await this.bindings.getBinding(workspaceId, revisionId)) ??
      (await this.bindings.bindRevision({ workspaceId, revisionId }));

    const targetVersion = binding.requiredSchemaVersion ?? 0;
    const prodEnv = await this.catalog.getEnvironment(app.id, 'prod');
    const currentProdVersion = prodEnv?.currentVersion ?? 0;

    if (targetVersion < currentProdVersion) {
      throw new AppDataException(
        AppDataErrorCode.PROD_DOWNGRADE_BLOCKED,
        `Revision requires schema v${targetVersion} but PROD is at v${currentProdVersion}`,
      );
    }

    let prodVersion = prodEnv?.currentVersion ?? 0;
    while (prodVersion < targetVersion) {
      const nextVersion = prodVersion + 1;
      const versions = await this.migrations.listVersions(app.id, 'dev', 100);
      const targetManifestRow = versions.find((v) => v.version === nextVersion);
      if (!targetManifestRow) {
        throw new AppDataException(
          AppDataErrorCode.NOT_PROVISIONED,
          `DEV schema version ${nextVersion} not found for PROD replay`,
        );
      }
      const manifest = targetManifestRow.manifestJson as import('../constants/app-data.types').AppDataSchemaManifest;
      const current = await this.migrations.getCurrentManifest(app.id, 'prod');
      const plan = this.diff.planMigration(current, manifest);
      if (plan.hasDestructive) {
        throw new AppDataException(
          AppDataErrorCode.DESTRUCTIVE_BLOCKED,
          `PROD migration to v${nextVersion} would be destructive`,
        );
      }
      await this.schema.applySchema({
        workspaceId,
        environment: 'prod',
        manifest,
        expectedVersion: prodVersion,
        actorPrincipal: 'deploy',
      });
      prodVersion = nextVersion;
    }

    await this.policies.replicatePolicies(app.id, 'dev', 'prod');

    const runtimeEnv = this.buildRuntimeEnv(app.appDataId, 'prod');
    this.logger.log(
      `PROD prepared workspaceId=${workspaceId} revisionId=${revisionId} appDataId=${app.appDataId} schemaVersion=${targetVersion}`,
    );
    return runtimeEnv;
  }
}
