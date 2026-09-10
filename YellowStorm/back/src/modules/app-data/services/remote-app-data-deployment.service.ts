import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppDataRuntimeEnv } from '../constants/app-data.types';
import type { AppDataEnvironment } from '../constants/app-data.constants';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import { AppDataClientService } from './app-data-client.service';

/**
 * Remote implementation of the AppDataDeploymentService contract.
 * Provisioning / release binding happen in the app-data microservice;
 * schema versions are tracked there, so no local replay is required.
 */
@Injectable()
export class RemoteAppDataDeploymentService {
  private readonly logger = new Logger(RemoteAppDataDeploymentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly client: AppDataClientService,
  ) {}

  resolvePublicUrl(appDataId: string, environment: AppDataEnvironment): string {
    const devBase = (
      this.config.get<string>('appData.remotePublicBaseUrl') || 'http://localhost:8443'
    ).replace(/\/$/, '');
    if (environment === 'dev') {
      return `${devBase}/v1/apps/${appDataId}/dev`;
    }

    // PROD deployed apps are served from https://apps.yellowsys.org — an
    // https page cannot call an http:// base (mixed content) and localhost
    // never resolves for visitors, so a dedicated public base is required.
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
      // Dev-host deploys keep working against the dev microservice base.
      return `${devBase}/v1/apps/${appDataId}/prod`;
    }
    return `${prodBase}/v1/apps/${appDataId}/prod`;
  }

  buildRuntimeEnv(appDataId: string, environment: AppDataEnvironment): AppDataRuntimeEnv {
    return {
      appDataId,
      environment,
      publicUrl: this.resolvePublicUrl(appDataId, environment),
    };
  }

  async getRuntimeEnvForWorkspace(
    workspaceId: string,
    environment: AppDataEnvironment = 'dev',
  ): Promise<AppDataRuntimeEnv | null> {
    if (!this.config.get<boolean>('appData.enabled', false)) return null;
    try {
      const app = await this.client.getAppByWorkspace(workspaceId);
      if (!app) return null;
      return this.buildRuntimeEnv(app.id, environment);
    } catch (err) {
      this.logger.warn(
        `Remote app lookup failed for workspaceId=${workspaceId}; proceeding without appDataRuntimeEnv`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  /**
   * Bind a release: provisions PROD in the microservice and copies DEV rows.
   * NOT_PROVISIONED propagates from the client (404) so callers can skip
   * App Data env vars, matching the local service's error semantics.
   */
  async prepareProduction(workspaceId: string, revisionId: string): Promise<AppDataRuntimeEnv> {
    const bound = await this.client.bindRelease(workspaceId, revisionId);
    const runtimeEnv = this.buildRuntimeEnv(bound.appDataId, 'prod');
    this.logger.log(
      `Remote PROD prepared workspaceId=${workspaceId} revisionId=${revisionId} appDataId=${bound.appDataId}`,
    );
    return runtimeEnv;
  }
}
