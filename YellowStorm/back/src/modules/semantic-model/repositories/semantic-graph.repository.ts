import { Injectable } from '@nestjs/common';
import { PoolClient, QueryResultRow } from 'pg';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import {
  SemanticGraph,
  SemanticGraphOperation,
  SemanticNodeType,
  SemanticRecord,
  SemanticRecordRelation,
  SemanticRelationType,
} from '../domain/semantic-model.types';

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

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
    switch (operation.type) {
      case 'node_type.create':
        await this.createNode(client, modelId, versionId, operation.entity);
        return;
      case 'node_type.update':
        await this.updateNode(client, modelId, versionId, operation.id, operation.changes);
        return;
      case 'node_type.delete':
        await this.deleteEntity(client, 'node_types', versionId, operation.id, 'SemanticNodeType');
        return;
      case 'relation_type.create':
        await this.createRelation(client, modelId, versionId, operation.entity);
        return;
      case 'relation_type.update':
        await this.updateRelation(client, modelId, versionId, operation.id, operation.changes);
        return;
      case 'relation_type.delete':
        await this.deleteEntity(client, 'relation_types', versionId, operation.id, 'SCHEMA_RELATION');
        return;
      case 'record.create':
        await this.createRecord(client, modelId, versionId, operation.entity);
        return;
      case 'record.update':
        await this.updateRecord(client, modelId, versionId, operation.id, operation.changes);
        return;
      case 'record.delete':
        await this.deleteEntity(client, 'records', versionId, operation.id, 'SemanticRecord');
        return;
      case 'record_relation.create':
        await this.createRecordRelation(client, modelId, versionId, operation.entity);
        return;
      case 'record_relation.update':
        const updatedRelation = await client.query<SemanticRecordRelation>(
          `UPDATE semantic_model.record_relations SET values=$3 WHERE version_id=$1 AND id=$2
           RETURNING id,relation_type_id AS "relationTypeId",source_record_id AS "sourceRecordId",target_record_id AS "targetRecordId",values`,
          [versionId,operation.id,JSON.stringify(operation.changes.values)],
        );
        await this.updateAge(client,'RECORD_RELATION',versionId,operation.id,{ ...updatedRelation.rows[0],modelId,versionId });
        return;
      case 'record_relation.delete':
        await this.deleteEntity(client, 'record_relations', versionId, operation.id, 'RECORD_RELATION');
        return;
      case 'layout.update':
        for (const item of operation.positions) {
          const node = await client.query<SemanticNodeType>(
            `UPDATE semantic_model.node_types SET position=$3,updated_at=now() WHERE version_id=$1 AND id=$2
             RETURNING id,key,label,description,category,record_policy AS "recordPolicy",system_key AS "systemKey",aliases,attributes,position`,
            [versionId,item.id,JSON.stringify(item.position)],
          );
          if (node.rows[0]) {
            await this.updateAge(client,'SemanticNodeType',versionId,item.id,{ ...node.rows[0],modelId,versionId });
          } else {
            const record = await client.query<SemanticRecord>(
              `UPDATE semantic_model.records SET position=$3,updated_at=now() WHERE version_id=$1 AND id=$2
               RETURNING id,node_type_id AS "nodeTypeId",label,values,status,position`,
              [versionId,item.id,JSON.stringify(item.position)],
            );
            if (record.rows[0]) await this.updateAge(client,'SemanticRecord',versionId,item.id,{ ...record.rows[0],modelId,versionId });
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
    await this.createAgeVertex(client, 'SemanticNodeType', { ...node, modelId, versionId });
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
    await this.updateAge(client,'SemanticNodeType',versionId,id,{ ...node,modelId,versionId });
  }

  private async createRelation(client: PoolClient, modelId: string, versionId: string, relation: SemanticRelationType): Promise<void> {
    await client.query(
      `INSERT INTO semantic_model.relation_types
       (id,model_id,version_id,key,label,inverse_label,description,source_node_type_id,target_node_type_id,cardinality,traversable,filterable,attributes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [relation.id, modelId, versionId, relation.key, relation.label, relation.inverseLabel, relation.description, relation.sourceNodeTypeId, relation.targetNodeTypeId, relation.cardinality, relation.traversable, relation.filterable, JSON.stringify(relation.attributes)],
    );
    await this.createAgeEdge(client, 'SemanticNodeType', relation.sourceNodeTypeId, 'SemanticNodeType', relation.targetNodeTypeId, 'SCHEMA_RELATION', versionId, { ...relation, modelId, versionId });
  }

  private async updateRelation(client: PoolClient, modelId: string, versionId: string, id: string, changes: Partial<SemanticRelationType>): Promise<void> {
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
    if (changes.sourceNodeTypeId || changes.targetNodeTypeId) {
      await this.deleteAge(client, 'SCHEMA_RELATION', versionId, id);
      await this.createAgeEdge(client, 'SemanticNodeType', relation.sourceNodeTypeId, 'SemanticNodeType', relation.targetNodeTypeId, 'SCHEMA_RELATION', versionId, { ...relation, modelId, versionId });
    } else {
      await this.updateAge(client,'SCHEMA_RELATION',versionId,id,{ ...relation,modelId,versionId });
    }
  }

  private async createRecord(client: PoolClient, modelId: string, versionId: string, record: SemanticRecord): Promise<void> {
    await client.query(
      `INSERT INTO semantic_model.records (id,model_id,version_id,node_type_id,label,values,status,position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [record.id,modelId,versionId,record.nodeTypeId,record.label,JSON.stringify(record.values),record.status,JSON.stringify(record.position)],
    );
    await this.createAgeVertex(client, 'SemanticRecord', { ...record, modelId, versionId });
    await this.createAgeEdge(client, 'SemanticRecord', record.id, 'SemanticNodeType', record.nodeTypeId, 'INSTANCE_OF', versionId, { id: `${record.id}:${record.nodeTypeId}`, modelId, versionId });
  }

  private async updateRecord(client: PoolClient, modelId: string, versionId: string, id: string, changes: Partial<SemanticRecord>): Promise<void> {
    const result = await client.query<SemanticRecord>(
      'SELECT id,node_type_id AS "nodeTypeId",label,values,status,position FROM semantic_model.records WHERE version_id=$1 AND id=$2', [versionId,id]);
    const record = { ...result.rows[0], ...changes };
    await client.query(
      `UPDATE semantic_model.records SET label=$3,values=$4,status=$5,position=$6,updated_at=now() WHERE version_id=$1 AND id=$2`,
      [versionId,id,record.label,JSON.stringify(record.values),record.status,JSON.stringify(record.position)],
    );
    await this.updateAge(client,'SemanticRecord',versionId,id,{ ...record,modelId,versionId });
  }

  private async createRecordRelation(client: PoolClient, modelId: string, versionId: string, relation: SemanticRecordRelation): Promise<void> {
    await client.query(
      `INSERT INTO semantic_model.record_relations
       (id,model_id,version_id,relation_type_id,source_record_id,target_record_id,values)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [relation.id,modelId,versionId,relation.relationTypeId,relation.sourceRecordId,relation.targetRecordId,JSON.stringify(relation.values)],
    );
    await this.createAgeEdge(client, 'SemanticRecord', relation.sourceRecordId, 'SemanticRecord', relation.targetRecordId, 'RECORD_RELATION', versionId, { ...relation, modelId, versionId });
  }

  private async deleteEntity(client: PoolClient, table: string, versionId: string, id: string, ageLabel: string): Promise<void> {
    const allowed = new Set(['node_types', 'relation_types', 'records', 'record_relations']);
    if (!allowed.has(table)) throw new Error('Invalid Semantic Model table');
    await client.query(`DELETE FROM semantic_model.${table} WHERE version_id = $1 AND id = $2`, [versionId, id]);
    await this.deleteAge(client, ageLabel, versionId, id);
  }

  private async createAgeVertex(client: Queryable, label: 'SemanticNodeType' | 'SemanticRecord', properties: Record<string, unknown>): Promise<void> {
    await this.age(client,
      `CREATE (n:${label} {id: $id, modelId: $modelId, versionId: $versionId, payload: $payload}) RETURN n`,
      { id: properties.id, modelId: properties.modelId, versionId: properties.versionId, payload: JSON.stringify(properties) });
  }

  private async createAgeEdge(client: Queryable, sourceLabel: string, sourceId: string, targetLabel: string, targetId: string, edgeLabel: string, versionId: string, properties: Record<string, unknown>): Promise<void> {
    await this.age(client,
      `MATCH (source:${sourceLabel}) WHERE source.id = $sourceId AND source.versionId = $versionId WITH source MATCH (target:${targetLabel}) WHERE target.id = $targetId AND target.versionId = $versionId CREATE (source)-[edge:${edgeLabel} {id: $id, modelId: $modelId, versionId: $versionId, payload: $payload}]->(target) RETURN edge`,
      { sourceId, targetId, id: properties.id, modelId: properties.modelId, versionId, payload: JSON.stringify(properties) });
  }

  private async updateAge(client: Queryable, label: string | null, versionId: string, id: string, entity: Record<string, unknown>): Promise<void> {
    const match = label ? `(entity:${label})` : '(entity)';
    await this.age(client, `MATCH ${match} WHERE entity.id = $id AND entity.versionId = $versionId SET entity.payload = $payload RETURN entity`, { id, versionId, payload: JSON.stringify(entity) });
  }

  private async deleteAge(client: Queryable, label: string, versionId: string, id: string): Promise<void> {
    const edge = ['SCHEMA_RELATION', 'INSTANCE_OF', 'RECORD_RELATION'].includes(label);
    await this.age(client, edge
      ? `MATCH ()-[entity:${label}]-() WHERE entity.id = $id AND entity.versionId = $versionId DELETE entity RETURN $id`
      : `MATCH (entity:${label}) WHERE entity.id = $id AND entity.versionId = $versionId DETACH DELETE entity RETURN $id`, { id, versionId });
  }

  private async age(client: Queryable, cypher: string, parameters: Record<string, unknown>): Promise<void> {
    const graph = this.database.graphName();
    await client.query(
      `SELECT * FROM ag_catalog.cypher('${graph}', $$ ${cypher} $$, $1::ag_catalog.agtype) AS (result ag_catalog.agtype)`,
      [JSON.stringify(parameters)],
    );
  }
}
