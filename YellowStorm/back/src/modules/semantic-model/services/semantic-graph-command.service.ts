import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GraphOperationsDto, SemanticRecordQueryDto } from '../dto';
import { SemanticGraphOperation } from '../domain/semantic-model.types';
import { parseSemanticGraphOperation } from '../domain/semantic-graph-operation.parser';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticGraphRepository } from '../repositories/semantic-graph.repository';
import { SemanticModelService } from './semantic-model.service';
import { SemanticModelValidationService } from './semantic-model-validation.service';

@Injectable()
export class SemanticGraphCommandService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly repository: SemanticGraphRepository,
    private readonly models: SemanticModelService,
    private readonly validation: SemanticModelValidationService,
  ) {}

  async getGraph(userId: string, modelId: string, layer = 'combined') {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const versionId = model.currentDraftVersionId ?? model.currentPublishedVersionId;
    if (!versionId) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const result = await this.database.query<{ revision: number }>('SELECT revision::int FROM semantic_model.versions WHERE id=$1', [versionId]);
    const graph = await this.repository.getGraph(modelId, versionId, result.rows[0]?.revision ?? 0);
    if (layer === 'structure') return { ...graph, records: [], recordRelations: [] };
    return graph;
  }

  async apply(userId: string, modelId: string, dto: GraphOperationsDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_VERSION_IMMUTABLE);
    const draftVersionId = model.currentDraftVersionId;
    const operations = dto.operations.map((operation) => this.parseOperation(operation));
    return this.database.transaction(async (client) => {
      const version = await client.query<{ revision: number; status: string }>(
        'SELECT revision::int,status FROM semantic_model.versions WHERE id=$1 FOR UPDATE', [draftVersionId]);
      if (!version.rows[0] || version.rows[0].status !== 'draft') throw new ConflictException(ErrorCode.SEMANTIC_MODEL_VERSION_IMMUTABLE);
      if (version.rows[0].revision !== dto.expectedRevision) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT);
      for (const operation of operations) {
        if (operation.type === 'node_type.create' && operation.entity.systemKey) {
          throw new ConflictException(ErrorCode.SEMANTIC_MODEL_PROTECTED_RESOURCE);
        }
        if (operation.type === 'node_type.delete' || operation.type === 'node_type.update') {
          const node = await client.query<{ systemKey: string | null }>('SELECT system_key AS "systemKey" FROM semantic_model.node_types WHERE id=$1 AND version_id=$2', [operation.id,draftVersionId]);
          if (!node.rowCount) this.invalidOperation('The selected concept does not exist in this draft');
          if (node.rows[0].systemKey) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_PROTECTED_RESOURCE);
          if (operation.type === 'node_type.update' && operation.changes.recordPolicy === 'none') {
            const records = await client.query('SELECT 1 FROM semantic_model.records WHERE version_id=$1 AND node_type_id=$2 LIMIT 1',[draftVersionId,operation.id]);
            if (records.rowCount) this.invalidOperation('Delete this concept’s Business Records before disabling records');
          }
          if (operation.type === 'node_type.delete') await this.requireNoNodeDependents(client,draftVersionId,operation.id);
        }
        if (operation.type === 'relation_type.update' || operation.type === 'relation_type.delete') {
          const relation = await client.query('SELECT 1 FROM semantic_model.relation_types WHERE version_id=$1 AND id=$2',[draftVersionId,operation.id]);
          if (!relation.rowCount) this.invalidOperation('The selected relationship does not exist in this draft');
          if (operation.type === 'relation_type.delete') {
            const dependents = await client.query('SELECT 1 FROM semantic_model.record_relations WHERE version_id=$1 AND relation_type_id=$2 LIMIT 1',[draftVersionId,operation.id]);
            if (dependents.rowCount) this.invalidOperation('Delete related Business Record links before deleting this relationship');
          }
        }
        if (operation.type === 'relation_type.create') {
          await this.validateNodeTargets(client,draftVersionId,[operation.entity.sourceNodeTypeId,operation.entity.targetNodeTypeId]);
        }
        if (operation.type === 'relation_type.update') {
          const changedTargets = [operation.changes.sourceNodeTypeId,operation.changes.targetNodeTypeId].filter((id): id is string=>Boolean(id));
          if (changedTargets.length) await this.validateNodeTargets(client,draftVersionId,changedTargets);
        }
        if (operation.type === 'record.create') {
          const allowed = await client.query(
            `SELECT 1 FROM semantic_model.node_types
             WHERE version_id=$1 AND id=$2 AND system_key IS NULL AND record_policy IN ('optional','expected')`,
            [draftVersionId,operation.entity.nodeTypeId],
          );
          if (!allowed.rowCount) this.invalidOperation('This concept does not allow Business Records');
        }
        if (operation.type === 'record.update' || operation.type === 'record.delete') {
          const allowed = await client.query(
            `SELECT 1 FROM semantic_model.records record
             JOIN semantic_model.node_types node ON node.version_id=record.version_id AND node.id=record.node_type_id
             WHERE record.version_id=$1 AND record.id=$2 AND node.system_key IS NULL`,
            [draftVersionId,operation.id],
          );
          if (!allowed.rowCount) this.invalidOperation('The Business Record does not exist or its concept does not allow records');
        }
        if (operation.type === 'record_relation.update' || operation.type === 'record_relation.delete') {
          const relation = await client.query('SELECT 1 FROM semantic_model.record_relations WHERE version_id=$1 AND id=$2',[draftVersionId,operation.id]);
          if (!relation.rowCount) this.invalidOperation('The selected Business Record link does not exist in this draft');
        }
        if (operation.type === 'layout.update' && operation.positions.length) {
          await this.validateLayoutTargets(client,draftVersionId,operation.positions.map((item)=>item.id));
        }
        if (operation.type === 'record_relation.create') {
          const compatible = await client.query<{ available: boolean }>(
            `SELECT NOT EXISTS (
               SELECT 1 FROM semantic_model.record_relations existing
               WHERE existing.version_id=relation.version_id AND existing.relation_type_id=relation.id
                 AND existing.source_record_id=source.id AND existing.target_record_id=target.id
             ) AS available
             FROM semantic_model.relation_types relation
             JOIN semantic_model.records source ON source.version_id=relation.version_id AND source.id=$3
             JOIN semantic_model.records target ON target.version_id=relation.version_id AND target.id=$4
             WHERE relation.version_id=$1 AND relation.id=$2
               AND source.node_type_id=relation.source_node_type_id
               AND target.node_type_id=relation.target_node_type_id`,
            [draftVersionId,operation.entity.relationTypeId,operation.entity.sourceRecordId,operation.entity.targetRecordId],
          );
          if (!compatible.rowCount) {
            this.invalidOperation('Business Records must follow an existing compatible concept relationship');
          }
          if (!compatible.rows[0].available) this.invalidOperation('These Business Records are already linked by this relationship');
        }
        await this.repository.apply(client, modelId, draftVersionId, operation);
      }
      const updated = await client.query<{ revision: number }>(
        `UPDATE semantic_model.versions SET revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision::int`, [draftVersionId]);
      await client.query('UPDATE semantic_model.models SET updated_at=now() WHERE id=$1', [modelId]);
      await this.models.audit(client, modelId, draftVersionId, userId, 'graph.operations_applied', { operationTypes: operations.map((operation) => operation.type) });
      return { revision: updated.rows[0].revision, operations };
    });
  }

  async validate(userId: string, modelId: string) {
    return { issues: this.validation.validate(await this.getGraph(userId, modelId)) };
  }

  async listRecords(userId: string, modelId: string, query: SemanticRecordQueryDto) {
    const model = await this.models.requireRole(userId, modelId, ['owner','editor','viewer']);
    const versionId = model.currentDraftVersionId ?? model.currentPublishedVersionId;
    if (!versionId) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const params: unknown[] = [versionId];
    let typeFilter = '';
    if (query.nodeTypeId) {
      params.push(query.nodeTypeId);
      typeFilter = ` AND node_type_id=$${params.length}`;
    }
    const count = await this.database.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM semantic_model.records WHERE version_id=$1${typeFilter}`, params);
    params.push(query.limit,(query.page-1)*query.limit);
    const records = await this.database.query(
      `SELECT id,node_type_id AS "nodeTypeId",label,values,status,position FROM semantic_model.records
       WHERE version_id=$1${typeFilter} ORDER BY label LIMIT $${params.length-1} OFFSET $${params.length}`, params);
    const total = count.rows[0]?.total ?? 0;
    return { items: records.rows, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total/query.limit) } };
  }

  async impact(userId: string, modelId: string, dto: GraphOperationsDto) {
    const graph = await this.getGraph(userId, modelId);
    const deletes = dto.operations.filter((operation) => typeof operation.type === 'string' && operation.type.endsWith('.delete'));
    return { affectedRecords: graph.records.filter((record) => deletes.some((operation) => operation.id === record.nodeTypeId)).length, affectedBindings: 0, operations: deletes.length };
  }

  private parseOperation(input: Record<string, unknown>): SemanticGraphOperation {
    return parseSemanticGraphOperation(input);
  }

  private invalidOperation(message: string): never {
    throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,message);
  }

  private async requireNoNodeDependents(client: PoolClient, versionId: string, nodeId: string): Promise<void> {
    const dependents = await client.query(
      `SELECT 1 FROM semantic_model.relation_types WHERE version_id=$1 AND (source_node_type_id=$2 OR target_node_type_id=$2)
       UNION ALL SELECT 1 FROM semantic_model.records WHERE version_id=$1 AND node_type_id=$2 LIMIT 1`,
      [versionId,nodeId],
    );
    if (dependents.rowCount) this.invalidOperation('Delete related relationships and Business Records before deleting this concept');
  }

  private async validateLayoutTargets(client: PoolClient, versionId: string, ids: string[]): Promise<void> {
    const targets = await client.query<{ id: string; protected: boolean }>(
      `SELECT node.id, (node.system_key IS NOT NULL) AS protected
       FROM semantic_model.node_types node WHERE node.version_id=$1 AND node.id=ANY($2::uuid[])
       UNION ALL
       SELECT record.id, (node.system_key IS NOT NULL) AS protected
       FROM semantic_model.records record
       JOIN semantic_model.node_types node ON node.version_id=record.version_id AND node.id=record.node_type_id
       WHERE record.version_id=$1 AND record.id=ANY($2::uuid[])`,
      [versionId,ids],
    );
    if (targets.rowCount !== ids.length) this.invalidOperation('Every layout target must exist in this draft');
    if (targets.rows.some((target)=>target.protected)) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_PROTECTED_RESOURCE);
  }

  private async validateNodeTargets(client: PoolClient, versionId: string, ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    const targets = await client.query('SELECT id FROM semantic_model.node_types WHERE version_id=$1 AND id=ANY($2::uuid[])',[versionId,uniqueIds]);
    if (targets.rowCount !== uniqueIds.length) this.invalidOperation('Every relationship endpoint must exist in this draft');
  }
}
