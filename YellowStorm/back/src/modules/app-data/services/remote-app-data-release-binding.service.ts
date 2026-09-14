import { Injectable, Logger } from '@nestjs/common';
import { AppDataErrorCode, AppDataException } from '../constants/app-data.errors';
import { AppDataClientService } from './app-data-client.service';

/**
 * Remote implementation of the AppDataReleaseBindingService contract.
 * Binding happens in the microservice (DEV → PROD copy); schema versions
 * are tracked remotely, so requiredSchemaVersion is always null here.
 */
@Injectable()
export class RemoteAppDataReleaseBindingService {
  private readonly logger = new Logger(RemoteAppDataReleaseBindingService.name);

  constructor(private readonly client: AppDataClientService) {}

  async bindRevision(params: {
    workspaceId: string;
    revisionId: string;
  }): Promise<{ requiredSchemaVersion: number | null }> {
    try {
      await this.client.bindRelease(params.workspaceId, params.revisionId);
      this.logger.log(
        `Remote release bound workspaceId=${params.workspaceId} revisionId=${params.revisionId}`,
      );
    } catch (err) {
      // Unprovisioned workspaces are a no-op for fire-and-forget callers.
      if (
        err instanceof AppDataException &&
        (err.appDataCode === AppDataErrorCode.NOT_PROVISIONED ||
          err.appDataCode === AppDataErrorCode.REMOTE_UNAVAILABLE)
      ) {
        this.logger.warn(
          `Remote release binding skipped workspaceId=${params.workspaceId}: ${err.appDataCode}`,
        );
        return { requiredSchemaVersion: null };
      }
      throw err;
    }
    return { requiredSchemaVersion: null };
  }

  async getBinding(
    _workspaceId: string,
    _revisionId: string,
  ): Promise<{ requiredSchemaVersion: number | null } | null> {
    // Bindings live in the microservice control plane; no local read model.
    return null;
  }
}
