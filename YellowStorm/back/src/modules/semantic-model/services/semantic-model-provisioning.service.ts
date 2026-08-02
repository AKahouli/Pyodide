import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { LoggerService } from '@modules/logger';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';

@Injectable()
export class SemanticModelProvisioningService {
  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
    private readonly models: SemanticModelService,
    private readonly database: SemanticModelDatabaseService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SemanticModelProvisioningService.name);
  }

  async afterWorkspaceCreated(ownerId: string, workspaceId: string): Promise<void> {
    if (!this.config.enabled || !this.config.autoProvision) return;
    try {
      await this.models.ensureWorkspaceDefault(ownerId, workspaceId);
    } catch (error) {
      this.logger.error('Default Semantic Model provisioning failed', {
        workspaceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async afterWorkspaceUpdated(ownerId: string, workspaceId: string, workspaceName: string): Promise<void> {
    if (!this.config.enabled) return;
    await this.runBestEffort('Semantic Model workspace name synchronization', workspaceId, () =>
      this.database.query(
        `UPDATE semantic_model.models SET name=$3,revision=revision+1,updated_at=now()
         WHERE owner_user_id=$1 AND origin_workspace_id=$2 AND name_managed_by_system=true AND archived_at IS NULL`,
        [ownerId,workspaceId,`${workspaceName} model`],
      ),
    );
  }

  async afterWorkspaceDeleted(ownerId: string, workspaceId: string): Promise<void> {
    if (!this.config.enabled) return;
    await this.runBestEffort('Semantic Model workspace deletion synchronization', workspaceId, () =>
      this.database.transaction(async (client) => {
        await client.query(
          `UPDATE semantic_model.models SET status='archived',archived_at=now(),revision=revision+1,updated_at=now()
           WHERE owner_user_id=$1 AND origin_workspace_id=$2`, [ownerId,workspaceId]);
        await client.query(
          `UPDATE semantic_model.workspace_links SET enabled=false,updated_at=now() WHERE workspace_id=$1`, [workspaceId]);
        await client.query(
          `UPDATE semantic_model.knowledge_bindings SET enabled=false,availability='unavailable',updated_at=now() WHERE workspace_id=$1`, [workspaceId]);
      }),
    );
  }

  private async runBestEffort(
    operation: string,
    workspaceId: string,
    execute: () => Promise<unknown>,
  ): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await execute();
        return;
      } catch (error) {
        const data = {
          workspaceId,
          attempt,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        if (attempt < maxAttempts) {
          this.logger.warn(`${operation} failed; retrying`, data);
        } else {
          this.logger.error(`${operation} failed`, data);
        }
      }
    }
  }
}
