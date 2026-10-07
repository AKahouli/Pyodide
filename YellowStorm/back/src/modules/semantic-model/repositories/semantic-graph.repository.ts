import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import {
  SemanticGraph,
  SemanticGraphOperation,
  SemanticNodeType,
  SemanticRecord,
  SemanticRecordRelation,
  SemanticRelationType,
} from '../domain/semantic-model.types';
import { SourceFieldMapping, withConceptFields } from '../domain/semantic-source-mapping.types';

@Injectable()
export class SemanticGraphRepository {
  constructor(private readonly database: SemanticModelDatabaseService) {}

  async getGraph(modelId: string, versionId: string, revision: number): Promise<SemanticGraph> {
    const [nodes, relations, records, recordRelations] = await Promise.all([
      this.database.query<SemanticNodeType>(
        `SELECT id, key, label, description, category, record_policy AS "recordPolicy",
          system_key AS "systemKey", aliases, attributes, position
         FROM semantic_model.node_types WHERE model_id = $1 AND version_id = $2 ORDER BY created_at`,
        [modelId, versionId],
      ),
      this.database.query<SemanticRelationType>(
        `SELECT id, key, label, inverse_label AS "inverseLabel", description,
          source_node_type_id AS "sourceNodeTypeId", target_node_type_id AS "targetNodeTypeId",
          cardinality, traversable, filterable, attributes
         FROM semantic_model.relation_types WHERE model_id = $1 AND version_id = $2 ORDER BY created_at`,
        [modelId, versionId],
      ),
      this.database.query<SemanticRecord>(
        `SELECT id, node_type_id AS "nodeTypeId", label, values, status, position
         FROM semantic_model.records WHERE model_id = $1 AND version_id = $2 ORDER BY created_at`,
        [modelId, versionId],
      ),
      this.database.query<SemanticRecordRelation>(
        `SELECT id, relation_type_id AS "relationTypeId", source_record_id AS "sourceRecordId",
          target_record_id AS "targetRecordId", values
         FROM semantic_model.record_relations WHERE model_id = $1 AND version_id = $2 ORDER BY created_at`,
        [modelId, versionId],
      ),
    ]);
    return { modelId, versionId, revision, nodes: nodes.rows, relations: relations.rows, records: records.rows, recordRelations: recordRelations.rows };
  }

  async apply(client: PoolClient, modelId: string, versionId: string, operation: SemanticGraphOperation): Promise<void> {
    // Draft ontology edits are relational state only. AGE is materialized later
    // by the explicit graph-build workflow, after mapping review.
    switch (operation.type) {
      case 'node_type.create':
        await this.createNode(client, modelId, versionId, operation.entity);
        return;
      case 'node_type.update':
        await this.updateNode(client, modelId, versionId, operation.id, operation.changes);
        return;
      case 'node_type.delete':
        await this.deleteEntity(client, 'node_types', versionId, operation.id);
        return;
      case 'relation_type.create':
        await this.createRelation(client, modelId, versionId, operation.entity);
        return;
      case 'relation_type.update':
        await this.updateRelation(client, versionId, operation.id, operation.changes);
        return;
      case 'relation_type.delete':
        await this.deleteEntity(client, 'relation_types', versionId, operation.id);
        return;
      case 'record.create':
        await this.createRecord(client, modelId, versionId, operation.entity);
        return;
      case 'record.update':
        await this.updateRecord(client, versionId, operation.id, operation.changes);
        return;
      case 'record.delete':
        await this.deleteEntity(client, 'records', versionId, operation.id);
        return;
      case 'record_relation.create':
        await this.createRecordRelation(client, modelId, versionId, operation.entity);
        return;
      case 'record_relation.update':
        await client.query(
          'UPDATE semantic_model.record_relations SET values=$3 WHERE version_id=$1 AND id=$2',
          [versionId,operation.id,JSON.stringify(operation.changes.values)],
        );
        return;
      case 'record_relation.delete':
        await this.deleteEntity(client, 'record_relations', versionId, operation.id);
        return;
      case 'layout.update':
        for (const item of operation.positions) {
          const node = await client.query<SemanticNodeType>(
            `UPDATE semantic_model.node_types SET position=$3,updated_at=now() WHERE version_id=$1 AND id=$2
               RETURNING id,key,label,description,category,record_policy AS "recordPolicy",system_key AS "systemKey",aliases,attributes,position`,
            [versionId,item.id,JSON.stringify(item.position)],
          );
          if (!node.rows[0]) {
            await client.query(
              'UPDATE semantic_model.records SET position=$3,updated_at=now() WHERE version_id=$1 AND id=$2',
              [versionId,item.id,JSON.stringify(item.position)],
            );
          }
        }
    }
  }

  private async createNode(client: PoolClient, modelId: string, versionId: string, node: SemanticNodeType): Promise<void> {
    await client.query(
      `INSERT INTO semantic_model.node_types
       (id, model_id, version_id, key, label, description, category, record_policy, system_key, aliases, attributes, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [node.id, modelId, versionId, node.key, node.label, node.description, node.category, node.recordPolicy, node.systemKey, JSON.stringify(node.aliases), JSON.stringify(node.attributes), JSON.stringify(node.position)],
    );
  }

  private async updateNode(client: PoolClient, modelId: string, versionId: string, id: string, changes: Partial<SemanticNodeType>): Promise<void> {
    const current = await client.query<SemanticNodeType>(
      `SELECT id, key, label, description, category, record_policy AS "recordPolicy", system_key AS "systemKey", aliases, attributes, position
       FROM semantic_model.node_types WHERE version_id = $1 AND id = $2`, [versionId, id]);
    const node = { ...current.rows[0], ...changes };
    await client.query(
      `UPDATE semantic_model.node_types SET key=$3,label=$4,description=$5,category=$6,record_policy=$7,
       aliases=$8,attributes=$9,position=$10,updated_at=now() WHERE version_id=$1 AND id=$2`,
      [versionId, id, node.key, node.label, node.description, node.category, node.recordPolicy, JSON.stringify(node.aliases), JSON.stringify(node.attributes), JSON.stringify(node.position)],
    );
    if (changes.attributes) await this.syncDocumentMappings(client, modelId, id, node.attributes ?? []);
  }

  /**
   * A field added to or removed from a concept is read, or no longer read, by its document sources
   * without saving each mapping again. Table sources keep their columns: a new field has no column
   * to read until one is chosen.
   */
  private async syncDocumentMappings(client: PoolClient, modelId: string, conceptId: string, attributes: readonly { key: string }[]): Promise<void> {
    const mappings = await client.query<{ id: string; fieldMappings: SourceFieldMapping[] }>(
      `SELECT id::text AS id, field_mappings AS "fieldMappings" FROM semantic_model.source_mappings
       WHERE model_id=$1 AND concept_id=$2 AND asset_kind='document' FOR UPDATE`,
      [modelId, conceptId],
    );
    for (const mapping of mappings.rows ?? []) {
      const synced = withConceptFields(mapping.fieldMappings ?? [], attributes);
      if (!synced.changed) continue;
      await client.query(
        'UPDATE semantic_model.source_mappings SET field_mappings=$2::jsonb, updated_at=now() WHERE id=$1',
        [mapping.id, JSON.stringify(synced.mappings)],
      );
    }
  }

  private async createRelation(client: PoolClient, modelId: string, versionId: string, relation: SemanticRelationType): Promise<void> {
    await client.query(
      `INSERT INTO semantic_model.relation_types
       (id,model_id,version_id,key,label,inverse_label,description,source_node_type_id,target_node_type_id,cardinality,traversable,filterable,attributes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [relation.id, modelId, versionId, relation.key, relation.label, relation.inverseLabel, relation.description, relation.sourceNodeTypeId, relation.targetNodeTypeId, relation.cardinality, relation.traversable, relation.filterable, JSON.stringify(relation.attributes)],
    );
  }

  private async updateRelation(client: PoolClient, versionId: string, id: string, changes: Partial<SemanticRelationType>): Promise<void> {
    const result = await client.query<SemanticRelationType>(
      `SELECT id,key,label,inverse_label AS "inverseLabel",description,source_node_type_id AS "sourceNodeTypeId",
       target_node_type_id AS "targetNodeTypeId",cardinality,traversable,filterable,attributes
       FROM semantic_model.relation_types WHERE version_id=$1 AND id=$2`, [versionId, id]);
    const relation = { ...result.rows[0], ...changes };
    await client.query(
      `UPDATE semantic_model.relation_types SET key=$3,label=$4,inverse_label=$5,description=$6,
       source_node_type_id=$7,target_node_type_id=$8,cardinality=$9,traversable=$10,filterable=$11,attributes=$12,updated_at=now()
       WHERE version_id=$1 AND id=$2`,
      [versionId,id,relation.key,relation.label,relation.inverseLabel,relation.description,relation.sourceNodeTypeId,relation.targetNodeTypeId,relation.cardinality,relation.traversable,relation.filterable,JSON.stringify(relation.attributes)],
    );
  }

  private async createRecord(client: PoolClient, modelId: string, versionId: string, record: SemanticRecord): Promise<void> {
    await client.query(
      `INSERT INTO semantic_model.records (id,model_id,version_id,node_type_id,label,values,status,position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [record.id,modelId,versionId,record.nodeTypeId,record.label,JSON.stringify(record.values),record.status,JSON.stringify(record.position)],
    );
  }

  private async updateRecord(client: PoolClient, versionId: string, id: string, changes: Partial<SemanticRecord>): Promise<void> {
    const result = await client.query<SemanticRecord>(
      'SELECT id,node_type_id AS "nodeTypeId",label,values,status,position FROM semantic_model.records WHERE version_id=$1 AND id=$2', [versionId,id]);
    const record = { ...result.rows[0], ...changes };
    await client.query(
      `UPDATE semantic_model.records SET label=$3,values=$4,status=$5,position=$6,updated_at=now() WHERE version_id=$1 AND id=$2`,
      [versionId,id,record.label,JSON.stringify(record.values),record.status,JSON.stringify(record.position)],
    );
  }

  private async createRecordRelation(client: PoolClient, modelId: string, versionId: string, relation: SemanticRecordRelation): Promise<void> {
    await client.query(
      `INSERT INTO semantic_model.record_relations
       (id,model_id,version_id,relation_type_id,source_record_id,target_record_id,values)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [relation.id,modelId,versionId,relation.relationTypeId,relation.sourceRecordId,relation.targetRecordId,JSON.stringify(relation.values)],
    );
  }

  private async deleteEntity(client: PoolClient, table: string, versionId: string, id: string): Promise<void> {
    const allowed = new Set(['node_types', 'relation_types', 'records', 'record_relations']);
    if (!allowed.has(table)) throw new Error('Invalid Semantic Model table');
    await client.query(`DELETE FROM semantic_model.${table} WHERE version_id = $1 AND id = $2`, [versionId, id]);
  }
}
