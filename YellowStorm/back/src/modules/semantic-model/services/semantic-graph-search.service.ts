import { Injectable } from '@nestjs/common';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';
import {
  RuntimeGraphExpandResult,
  RuntimeGraphExpandStep,
  RuntimeGraphSearchIndexStatus,
  RuntimeGraphSearchResult,
  RuntimeSearchEnvironment,
  SemanticRuntimeClientService,
} from './semantic-runtime-client.service';

export interface GraphSearchQuery {
  environment: RuntimeSearchEnvironment;
  query: string;
  concepts?: string[];
  limit?: number;
  expectedDataRevisionId?: string;
}

export interface GraphExpandQuery {
  environment: RuntimeSearchEnvironment;
  seedEntityIds: string[];
  steps: RuntimeGraphExpandStep[];
  maxNodes?: number;
  expectedDataRevisionId?: string;
}

const READ_ROLES = ['owner', 'editor', 'viewer'];
const EDIT_ROLES = ['owner', 'editor'];

/**
 * Finds records in the data of a semantic model and follows their real links, for the editor and for
 * assistants. Published data (production) is open to anyone who can read the model once it is published;
 * the draft's data is for the people who edit it. Every call carries the workspaces whose sources the person
 * may read now, so a record built from a source they lost access to stays hidden without reindexing.
 */
@Injectable()
export class SemanticGraphSearchService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly workspaceShares: WorkspaceShareService,
    private readonly runtime: SemanticRuntimeClientService,
  ) {}

  async search(userId: string, modelId: string, input: GraphSearchQuery): Promise<RuntimeGraphSearchResult> {
    const model = await this.requireReadable(userId, modelId, input.environment);
    const allowedWorkspaceIds = await this.allowedWorkspaceIds(userId, model.id);
    return this.bound(input.environment, () => this.runtime.graphSearch({
      actorUserId: userId,
      modelId: model.id,
      environment: input.environment,
      query: input.query,
      ...(input.concepts?.length ? { concepts: input.concepts } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
      allowedWorkspaceIds,
      ...(input.expectedDataRevisionId ? { expectedDataRevisionId: input.expectedDataRevisionId } : {}),
    }));
  }

  async expand(userId: string, modelId: string, input: GraphExpandQuery): Promise<RuntimeGraphExpandResult> {
    const model = await this.requireReadable(userId, modelId, input.environment);
    const allowedWorkspaceIds = await this.allowedWorkspaceIds(userId, model.id);
    return this.bound(input.environment, () => this.runtime.graphExpand({
      actorUserId: userId,
      modelId: model.id,
      environment: input.environment,
      seedEntityIds: input.seedEntityIds,
      steps: input.steps,
      ...(input.maxNodes ? { maxNodes: input.maxNodes } : {}),
      allowedWorkspaceIds,
      ...(input.expectedDataRevisionId ? { expectedDataRevisionId: input.expectedDataRevisionId } : {}),
    }));
  }

  async indexStatus(userId: string, modelId: string, environment: RuntimeSearchEnvironment): Promise<RuntimeGraphSearchIndexStatus> {
    const model = await this.requireReadable(userId, modelId, environment);
    return this.bound(environment, () => this.runtime.getGraphSearchIndex(model.id, environment, userId));
  }

  /** Building an index costs embedding calls, so only the people who edit the model can start one. */
  async ensureIndex(userId: string, modelId: string, environment: RuntimeSearchEnvironment) {
    const model = await this.models.requireActiveRole(userId, modelId, EDIT_ROLES);
    return this.bound(environment, () => this.runtime.ensureGraphSearchIndex({ actorUserId: userId, modelId: model.id, environment }));
  }

  /**
   * The workspaces whose documents the person may read now, among those the model takes data from: the same
   * intersection as SemanticDataGrantService.issue (mapped sources ∩ WorkspaceShareService.filterAccessible),
   * widened to the model's linked workspaces so a record keeps its sources visible while a mapping is redone.
   */
  async allowedWorkspaceIds(userId: string, modelId: string): Promise<string[]> {
    const result = await this.database.query<{ workspaceId: string }>(
      `SELECT workspace_id AS "workspaceId" FROM semantic_model.source_mappings WHERE model_id=$1
       UNION
       SELECT workspace_id AS "workspaceId" FROM semantic_model.workspace_links WHERE model_id=$1
       ORDER BY 1`,
      [modelId],
    );
    const candidates = [...new Set(result.rows.map((row) => row.workspaceId).filter(Boolean))];
    if (!candidates.length) return [];
    return this.workspaceShares.filterAccessible(userId, candidates);
  }

  private async requireReadable(userId: string, modelId: string, environment: RuntimeSearchEnvironment) {
    const model = await this.models.requireRole(userId, modelId, environment === 'draft' ? EDIT_ROLES : READ_ROLES);
    if (model.status === 'archived') throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND);
    return model;
  }

  /** No data bound to the environment: published data needs a publish, draft data a data update. */
  private async bound<T>(environment: RuntimeSearchEnvironment, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ConflictException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, environment === 'production'
          ? 'Publish this semantic model to use it in chat'
          : 'This semantic model has no data yet: run a data update first');
      }
      throw error;
    }
  }
}
