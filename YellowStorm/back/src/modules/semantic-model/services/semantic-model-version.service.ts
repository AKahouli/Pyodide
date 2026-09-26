import { Injectable, Logger } from '@nestjs/common';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticGraphOperation } from '../domain/semantic-model.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticGraphRepository } from '../repositories/semantic-graph.repository';
import { SemanticModelService } from './semantic-model.service';
import { SemanticModelValidationService } from './semantic-model-validation.service';
import { SemanticRuntimeClientService } from './semantic-runtime-client.service';

@Injectable()
export class SemanticModelVersionService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly graphRepository: SemanticGraphRepository,
    private readonly models: SemanticModelService,
    private readonly validation: SemanticModelValidationService,
    private readonly runtime: SemanticRuntimeClientService,
  ) {}

  private readonly logger = new Logger(SemanticModelVersionService.name);

  async list(userId: string, modelId: string) {
    await this.models.requireRole(userId, modelId, ['owner','editor','viewer']);
    const result = await this.database.query(
      `SELECT id,version_number AS "versionNumber",status,revision::int,base_version_id AS "baseVersionId",
       created_by AS "createdBy",published_by AS "publishedBy",published_at AS "publishedAt",created_at AS "createdAt"
       FROM semantic_model.versions WHERE model_id=$1 ORDER BY version_number DESC`, [modelId]);
    return result.rows;
  }

  async publish(userId: string, modelId: string, expectedRevision: number, expectedGraphRevision: number) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner','editor']);
    if (!model.currentDraftVersionId) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const draftVersionId = model.currentDraftVersionId;
    const published = await this.database.transaction(async (client) => {
      const modelRevision = await this.models.advanceRevision(client,modelId,expectedRevision);
      const locked = await client.query<{ version_number: number; revision: number }>(
        `SELECT version_number,revision::int FROM semantic_model.versions
         WHERE id=$1 AND status='draft' AND revision=$2 FOR UPDATE`,
        [draftVersionId,expectedGraphRevision],
      );
      if (!locked.rows[0]) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT);
      // The version row lock serializes graph commands; validate the exact snapshot being published.
      const graph = await this.graphRepository.getGraph(modelId,draftVersionId,expectedGraphRevision);
      const errors = this.validation.validate(graph).filter((issue) => issue.severity === 'error');
      if (errors.length) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED);
      await client.query(
        `UPDATE semantic_model.versions SET status='published',published_by=$2,published_at=now(),snapshot_hash=encode(digest($3,'sha256'),'hex'),updated_at=now() WHERE id=$1`,
        [draftVersionId,userId,JSON.stringify(graph)],
      );
      const draft = await client.query<{ id: string }>(
        `INSERT INTO semantic_model.versions(model_id,version_number,status,revision,base_version_id,created_by)
         VALUES($1,$2,'draft',0,$3,$4) RETURNING id`,
        [modelId,locked.rows[0].version_number + 1,draftVersionId,userId],
      );
      await client.query(
        `UPDATE semantic_model.models SET status='published',current_published_version_id=$2,current_draft_version_id=$3,updated_at=now() WHERE id=$1`,
        [modelId,draftVersionId,draft.rows[0].id],
      );
      await this.cloneGraph(client, graph, modelId, draft.rows[0].id);
      await this.models.audit(client, modelId, draftVersionId, userId, 'version.published', { nextDraftVersionId: draft.rows[0].id });
      return { publishedVersionId: draftVersionId, draftVersionId: draft.rows[0].id, revision: modelRevision };
    });
    return { ...published, data: await this.publishData(userId, modelId, draftVersionId) };
  }

  /**
   * Makes the records built from the published version the ones chat reads. Records built from an
   * older version, or not built yet, stay unpublished; the structure is published either way.
   */
  private async publishData(userId: string, modelId: string, versionId: string): Promise<{ published: boolean; reason?: string }> {
    try {
      await this.runtime.publishModelData(modelId, { actorUserId: userId, modelVersionId: versionId });
      return { published: true };
    } catch (error) {
      const reason = error instanceof ConflictException ? String(error.message) : 'runtime_unavailable';
      this.logger.warn(`Semantic model ${modelId} published without data: ${reason}`);
      return { published: false, reason };
    }
  }

  async compare(userId: string, modelId: string, leftId: string, rightId: string) {
    await this.models.requireRole(userId, modelId, ['owner','editor','viewer']);
    const versions = await this.database.query<{ id: string; revision: number }>(
      'SELECT id,revision::int FROM semantic_model.versions WHERE model_id=$1 AND id=ANY($2::uuid[])', [modelId,[leftId,rightId]]);
    if (versions.rowCount !== 2) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND);
    const left = await this.graphRepository.getGraph(modelId,leftId,versions.rows.find((item) => item.id === leftId)?.revision ?? 0);
    const right = await this.graphRepository.getGraph(modelId,rightId,versions.rows.find((item) => item.id === rightId)?.revision ?? 0);
    const keys = (items: Array<{ key: string }>) => new Set(items.map((item) => item.key));
    const leftNodes = keys(left.nodes); const rightNodes = keys(right.nodes);
    const leftRelations = keys(left.relations); const rightRelations = keys(right.relations);
    return {
      nodesAdded: [...rightNodes].filter((key) => !leftNodes.has(key)),
      nodesRemoved: [...leftNodes].filter((key) => !rightNodes.has(key)),
      relationsAdded: [...rightRelations].filter((key) => !leftRelations.has(key)),
      relationsRemoved: [...leftRelations].filter((key) => !rightRelations.has(key)),
      recordCountChange: right.records.length - left.records.length,
    };
  }

  async restore(userId: string, modelId: string, versionId: string, expectedRevision: number, expectedGraphRevision: number) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner','editor']);
    const sourceVersion = await this.database.query<{ revision: number }>(
      'SELECT revision::int FROM semantic_model.versions WHERE model_id=$1 AND id=$2', [modelId,versionId]);
    if (!sourceVersion.rows[0]) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND);
    const source = await this.graphRepository.getGraph(modelId,versionId,sourceVersion.rows[0].revision);
    return this.database.transaction(async (client) => {
      // Keep the same model-then-draft lock order as publish to avoid deadlocks.
      const modelRevision = await this.models.advanceRevision(client,modelId,expectedRevision);
      if (model.currentDraftVersionId) {
        const lockedDraft = await client.query(
          `SELECT 1 FROM semantic_model.versions WHERE id=$1 AND status='draft' AND revision=$2 FOR UPDATE`,
          [model.currentDraftVersionId,expectedGraphRevision],
        );
        if (!lockedDraft.rowCount) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT);
      }
      if (model.currentDraftVersionId) await client.query("UPDATE semantic_model.versions SET status='archived' WHERE id=$1", [model.currentDraftVersionId]);
      const max = await client.query<{ next: number }>('SELECT COALESCE(MAX(version_number),0)::int+1 AS next FROM semantic_model.versions WHERE model_id=$1', [modelId]);
      const draft = await client.query<{ id: string }>(
        `INSERT INTO semantic_model.versions(model_id,version_number,status,base_version_id,created_by) VALUES($1,$2,'draft',$3,$4) RETURNING id`,
        [modelId,max.rows[0].next,versionId,userId]);
      await client.query('UPDATE semantic_model.models SET current_draft_version_id=$2,updated_at=now() WHERE id=$1', [modelId,draft.rows[0].id]);
      await this.cloneGraph(client,source,modelId,draft.rows[0].id);
      return { draftVersionId: draft.rows[0].id, revision: modelRevision };
    });
  }

  private async cloneGraph(client: import('pg').PoolClient, source: Awaited<ReturnType<SemanticGraphRepository['getGraph']>>, modelId: string, versionId: string): Promise<void> {
    const operations: SemanticGraphOperation[] = [
      ...source.nodes.map((node): SemanticGraphOperation => ({ type:'node_type.create',entity:node })),
      ...source.relations.map((relation): SemanticGraphOperation => ({ type:'relation_type.create',entity:relation })),
      ...source.records.map((record): SemanticGraphOperation => ({ type:'record.create',entity:record })),
      ...source.recordRelations.map((relation): SemanticGraphOperation => ({ type:'record_relation.create',entity:relation })),
    ];
    for (const operation of operations) await this.graphRepository.apply(client,modelId,versionId,operation);
  }
}
