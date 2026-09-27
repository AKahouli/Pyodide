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

  /**
   * What changes between two versions, in business terms: concepts, fields and relationships added,
   * removed or renamed (matched by id, so a rename is not an add plus a remove), relationship
   * cardinality changes, and how many prepared records each side has when the runtime knows.
   */
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
      changes: describeVersionChanges(left, right),
      records: await this.preparedRecordCounts(userId, modelId, leftId, rightId),
    };
  }

  /** Prepared record counts for the two versions, from the runtime's draft and published data. */
  private async preparedRecordCounts(userId: string, modelId: string, leftId: string, rightId: string) {
    try {
      const summary = await this.runtime.getDataSummary(modelId, userId);
      const countOf = (versionId: string) => [summary.draft, summary.production]
        .find((side) => side?.modelVersionId === versionId)?.records ?? null;
      const before = countOf(leftId);
      const after = countOf(rightId);
      return { before, after, change: before != null && after != null ? after - before : null };
    } catch {
      return { before: null, after: null, change: null };
    }
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

export type VersionChange =
  | { kind: 'concept_added' | 'concept_removed'; concept: string }
  | { kind: 'concept_renamed'; from: string; to: string }
  | { kind: 'field_added' | 'field_removed'; concept: string; field: string }
  | { kind: 'field_renamed'; concept: string; from: string; to: string }
  | { kind: 'field_type_changed'; concept: string; field: string; from: string; to: string }
  | { kind: 'field_required_changed'; concept: string; field: string; required: boolean }
  | { kind: 'relation_added' | 'relation_removed'; relation: string; source: string; target: string }
  | { kind: 'relation_renamed'; from: string; to: string; source: string; target: string }
  | { kind: 'relation_cardinality_changed'; relation: string; source: string; target: string; from: string; to: string };

type ComparableGraph = Pick<Awaited<ReturnType<SemanticGraphRepository['getGraph']>>, 'nodes' | 'relations'>;

/** Business-readable differences from `left` to `right`, by labels (never ids). */
export function describeVersionChanges(left: ComparableGraph, right: ComparableGraph): VersionChange[] {
  const changes: VersionChange[] = [];
  const name = (node: { label: string; key: string }) => node.label || node.key;
  const leftNodes = new Map(left.nodes.map((node) => [node.id, node]));
  const rightNodes = new Map(right.nodes.map((node) => [node.id, node]));
  const nodeName = (id: string) => { const node = rightNodes.get(id) ?? leftNodes.get(id); return node ? name(node) : ''; };
  for (const node of right.nodes) {
    const before = leftNodes.get(node.id);
    if (!before) { changes.push({ kind: 'concept_added', concept: name(node) }); continue; }
    if (name(before) !== name(node)) changes.push({ kind: 'concept_renamed', from: name(before), to: name(node) });
    const beforeFields = new Map((before.attributes ?? []).map((field) => [field.key, field]));
    const afterFields = new Map((node.attributes ?? []).map((field) => [field.key, field]));
    for (const field of node.attributes ?? []) {
      const old = beforeFields.get(field.key);
      const label = field.label || field.key;
      if (!old) { changes.push({ kind: 'field_added', concept: name(node), field: label }); continue; }
      if ((old.label || old.key) !== label) changes.push({ kind: 'field_renamed', concept: name(node), from: old.label || old.key, to: label });
      if (old.type !== field.type) changes.push({ kind: 'field_type_changed', concept: name(node), field: label, from: old.type, to: field.type });
      if (Boolean(old.required) !== Boolean(field.required)) changes.push({ kind: 'field_required_changed', concept: name(node), field: label, required: Boolean(field.required) });
    }
    for (const field of before.attributes ?? []) {
      if (!afterFields.has(field.key)) changes.push({ kind: 'field_removed', concept: name(node), field: field.label || field.key });
    }
  }
  for (const node of left.nodes) if (!rightNodes.has(node.id)) changes.push({ kind: 'concept_removed', concept: name(node) });
  const leftRelations = new Map(left.relations.map((relation) => [relation.id, relation]));
  const rightRelations = new Set(right.relations.map((relation) => relation.id));
  const ends = (relation: { sourceNodeTypeId: string; targetNodeTypeId: string }) => ({ source: nodeName(relation.sourceNodeTypeId), target: nodeName(relation.targetNodeTypeId) });
  for (const relation of right.relations) {
    const before = leftRelations.get(relation.id);
    if (!before) { changes.push({ kind: 'relation_added', relation: name(relation), ...ends(relation) }); continue; }
    if (name(before) !== name(relation)) changes.push({ kind: 'relation_renamed', from: name(before), to: name(relation), ...ends(relation) });
    if (before.cardinality !== relation.cardinality) {
      changes.push({ kind: 'relation_cardinality_changed', relation: name(relation), ...ends(relation), from: before.cardinality, to: relation.cardinality });
    }
  }
  for (const relation of left.relations) if (!rightRelations.has(relation.id)) changes.push({ kind: 'relation_removed', relation: name(relation), ...ends(relation) });
  return changes;
}
