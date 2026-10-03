import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { graphDiff } from '../domain/graph-diff';
import {
  attributeTypes,
  type AttributeDefinition,
  type AttributeType,
  type RecordPolicy,
  type SemanticGraph,
  type SemanticGraphOperation,
  type SemanticNodeType,
  type SemanticRelationType,
} from '../domain/semantic-model.types';
import { SemanticModelService } from './semantic-model.service';
import { SemanticGraphCommandService } from './semantic-graph-command.service';
import { SemanticModelValidationService } from './semantic-model-validation.service';
import { SemanticCrossSourceService } from './semantic-cross-source.service';
import { SemanticSourceMappingService, DOCUMENT_MIME_TYPES, STRUCTURED_MIME_PREFIXES } from './semantic-source-mapping.service';
import { SemanticModelWorkspaceService } from './semantic-model-workspace.service';
import { SemanticPopulationRefreshService } from './semantic-population-refresh.service';
import { SemanticModelVersionService } from './semantic-model-version.service';
import { SemanticGraphSearchService } from './semantic-graph-search.service';
import type { RecordsQuery } from './semantic-graph-search.service';
import type { RuntimeGraphExpandStep, RuntimeRecordsQueryResult, RuntimeSearchEnvironment } from './semantic-runtime-client.service';

/**
 * What an assistant (an agent using the semantic model MCP) can do to a model, as the person it acts for.
 * Concepts, fields and relationships are named by their business names, never by internal ids. Every
 * change an assistant makes is recorded as one change set that people can see in the editor and undo.
 */

export type Cardinality = SemanticRelationType['cardinality'];

/** Assistants read the published data unless they work on the draft. */
export type AssistantDataChoice = 'published' | 'draft';
const assistantEnvironment = (data: AssistantDataChoice): RuntimeSearchEnvironment => (data === 'draft' ? 'draft' : 'production');

export interface AssistantFieldSpec {
  key?: string;
  label: string;
  type?: AttributeType;
  required?: boolean;
  description?: string;
  options?: string[];
  aliases?: string[];
}

export interface AssistantConceptSpec {
  /** An existing concept (key or name) to change; otherwise the concept is found by `label` or added. */
  concept?: string;
  label?: string;
  newLabel?: string;
  description?: string;
  category?: 'business_object' | 'classification';
  recordPolicy?: RecordPolicy;
  aliases?: string[];
  fields?: AssistantFieldSpec[];
  removeFields?: string[];
  keyFields?: string[];
}

export interface AssistantRelationSpec {
  from: string;
  to: string;
  label: string;
  key?: string;
  inverseLabel?: string;
  description?: string;
  cardinality?: Cardinality;
}

export interface AssistantRelationRef {
  from: string;
  to: string;
  label?: string;
}

export interface AssistantModelChanges {
  concepts?: AssistantConceptSpec[];
  relations?: AssistantRelationSpec[];
  removeConcepts?: string[];
  removeRelations?: AssistantRelationRef[];
}

export interface AssistantActor {
  userId: string;
  agentId?: string | null;
  conversationId?: string | null;
}

export type DocumentFieldMethod = 'ai' | 'extract' | 'document_name' | 'ignore' | { constant: string };

export interface SourceSnapshot {
  id: string;
  conceptId: string;
  workspaceId: string;
  documentId: string;
  sheetName: string;
  assetKind: string;
  fieldMappings: Array<Record<string, unknown>>;
  identityFields: string[];
  scope?: string;
  folderId?: string | null;
  selection?: { folderIds: string[]; documentIds: string[] } | null;
  documentName?: string;
}

export interface ChangeSummary {
  message: string;
  added: string[];
  changed: string[];
  removed: string[];
}

export interface ChangeSetRow {
  id: string;
  modelId: string;
  versionId: string;
  actorUserId: string;
  agentId: string | null;
  summary: ChangeSummary;
  graphForward: SemanticGraphOperation[];
  graphUndo: SemanticGraphOperation[];
  identityBefore: Record<string, string[]>;
  identityAfter: Record<string, string[]>;
  sourcesAdded: SourceSnapshot[];
  sourcesRemoved: SourceSnapshot[];
  createdAt: string;
  undoneAt: string | null;
}

/** Where a button in the conversation takes the person: the model's canvas, or its suggested sources. */
export interface AssistantUiTarget {
  surface: 'semanticModel.editor' | 'semanticModel.sources';
  params: { modelId: string; modelName: string };
}

/** A source the assistant suggests for a concept, as the person asked for it or as it proposes it. */
export interface SourceSuggestionOptionInput {
  workspaceId: string;
  folderIds?: string[];
  documentIds?: string[];
  sheetName?: string;
  reason?: string;
}

export interface SourceSuggestionInput {
  concept: string;
  /** Empty or absent: the person chooses the files from the list of their workspaces. */
  options?: SourceSuggestionOptionInput[];
  note?: string;
}

/** One suggested source, with the names and counts a person needs to judge it. */
export interface SourceSuggestionOption {
  workspaceId: string;
  workspaceName: string;
  /** workspace: every file; documents: picked folders and files; document / spreadsheet: one file. */
  kind: 'workspace' | 'documents' | 'document' | 'spreadsheet';
  folderIds: string[];
  documentIds: string[];
  folders: string[];
  documents: string[];
  sheetName?: string;
  mimeType?: string;
  fileCount: number;
  stillIndexing: number;
  reason: string;
}

interface SuggestionRow {
  id: string;
  conceptId: string;
  conceptKey: string;
  options: SourceSuggestionOption[];
  note: string;
  status: 'pending' | 'skipped';
  createdAt: string;
  updatedAt: string;
}

const MAX_CONCEPTS_PER_CHANGE = 60;
const MAX_SUGGESTED_CONCEPTS = 30;
const MAX_OPTIONS_PER_CONCEPT = 5;
const RUN_ENDED = new Set(['completed', 'completed_with_gaps', 'failed', 'cancelled', 'superseded']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANGE_SET_COLUMNS = `id, model_id AS "modelId", version_id AS "versionId", actor_user_id AS "actorUserId", agent_id AS "agentId",
  summary, graph_forward AS "graphForward", graph_undo AS "graphUndo", identity_before AS "identityBefore",
  identity_after AS "identityAfter", sources_added AS "sourcesAdded", sources_removed AS "sourcesRemoved",
  created_at AS "createdAt", undone_at AS "undoneAt"`;

/** A business name as an internal key: "Invoice line" -> "invoice_line". */
export function businessKey(label: string, fallback = 'item'): string {
  const key = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  if (!key) return fallback;
  return /^[a-z]/.test(key) ? key : `${fallback}_${key}`;
}

const normalize = (value: string) => value.trim().toLowerCase();

/** A field as an assistant needs it to query: names, type, allowed values and meaning. */
function describeField(field: AttributeDefinition) {
  return {
    key: field.key, label: field.label, type: field.type,
    ...(field.options?.length ? { options: field.options } : {}),
    ...(field.description ? { description: field.description } : {}),
    ...(field.aliases?.length ? { aliases: field.aliases } : {}),
  };
}

const HOW_TO_QUERY = 'query_records(concept, filters=[{field, op, value}], match="all"|"any", group_by=[field | {field, bucket}], '
  + 'aggregates=[{op, field}], order_by=[{field, direction}], fields, limit, offset). Name concepts and fields by key or label from '
  + 'this description; "name" is the record name; "<relation>.<field>" filters on a linked record (relation by key, label or inverse label). '
  + 'ops: eq, ne, contains, starts_with, ends_with, in, gt, gte, lt, lte, between, is_empty, not_empty; text ignores case and accents. '
  + 'Dates: ISO (2026-07-14, 2026-07, 2026) or today, yesterday, last_N_days|weeks|months|years, this_/last_week|month|quarter|year (UTC); '
  + 'buckets: day, week, month, quarter, year. aggregates: count, count_distinct, sum, avg, min, max. limit 0 returns only counts.';

/** The answer of a valid records query: groups, or a page of records with optional totals. */
function queryResultBody(result: RuntimeRecordsQueryResult) {
  const common = { total: result.total ?? 0, ...(result.unparsable && Object.keys(result.unparsable).length ? { unparsable: result.unparsable } : {}) };
  if (result.buckets) return { ...common, groups: result.buckets, truncated: Boolean(result.bucketsTruncated) };
  const more = result.nextOffset !== null && result.nextOffset !== undefined;
  return {
    ...common, ...(result.aggregates ? { totals: result.aggregates } : {}),
    records: result.records ?? [], offset: result.offset ?? 0, nextOffset: more ? result.nextOffset : null, truncated: more,
  };
}

/** What a records query left out or could not read, said so the assistant reports it. */
function queryNotes(result: RuntimeRecordsQueryResult): string[] {
  const notes: string[] = [];
  const applied = result.appliedQuery;
  const fields = new Map<string, { label: string; type: string }>();
  for (const filter of applied.filters ?? []) {
    if (filter.field && !filter.relation) fields.set(filter.field, { label: filter.fieldLabel ?? filter.field, type: filter.type ?? 'text' });
  }
  for (const group of applied.groupBy ?? []) fields.set(group.field, { label: group.label, type: group.type });
  for (const aggregate of applied.aggregates ?? []) {
    if (aggregate.field && !fields.has(aggregate.field)) {
      fields.set(aggregate.field, { label: aggregate.label ?? aggregate.field, type: aggregate.op === 'sum' || aggregate.op === 'avg' ? 'number' : 'value' });
    }
  }
  const kinds: Record<string, string> = { date: 'dates', number: 'numbers', boolean: 'yes/no values' };
  for (const [key, count] of Object.entries(result.unparsable ?? {})) {
    const field = fields.get(key) ?? { label: key, type: 'value' };
    notes.push(`${String(count)} value${count > 1 ? 's' : ''} of "${field.label}" could not be read as ${kinds[field.type] ?? 'typed values'} and ${count > 1 ? 'were' : 'was'} left out of the comparisons, groups and totals on this field. Say so in the answer.`);
  }
  if (result.hiddenRecords) notes.push(`${String(result.hiddenRecords)} records of this concept come from sources the user cannot open: they are not counted or shown.`);
  if (result.total === 0) notes.push('No record matches this query.');
  if (result.bucketsTruncated) notes.push(`Only the first ${String(result.buckets?.length ?? 0)} groups are returned: more exist. Say the list is incomplete, or narrow the query.`);
  if (!result.buckets && result.nextOffset !== null && result.nextOffset !== undefined) {
    const first = (result.offset ?? 0) + 1;
    notes.push(`Records ${String(first)} to ${String(first + (result.returned ?? 0) - 1)} of ${String(result.total ?? 0)} are returned${result.pageCutShort ? ' (the page stopped early: the values are long)' : ''}; call again with offset=${String(result.nextOffset)} for the next ones, or say the list is incomplete.`);
  }
  if (result.records?.some((record) => record.truncated)) notes.push('Some long values were cut at 1500 characters (truncated: true): say so if they matter.');
  return notes;
}

@Injectable()
export class SemanticModelAssistantService {
  private readonly logger = new Logger(SemanticModelAssistantService.name);

  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly graph: SemanticGraphCommandService,
    private readonly validation: SemanticModelValidationService,
    private readonly crossSource: SemanticCrossSourceService,
    private readonly sourceMappings: SemanticSourceMappingService,
    private readonly modelWorkspaces: SemanticModelWorkspaceService,
    private readonly population: SemanticPopulationRefreshService,
    private readonly versions: SemanticModelVersionService,
    private readonly workspaces: WorkspaceService,
    private readonly workspaceShares: WorkspaceShareService,
    private readonly documents: WorkspaceDocumentService,
    private readonly graphSearch: SemanticGraphSearchService,
  ) {}

  // ── Models ────────────────────────────────────────────────────────────────

  async listModels(userId: string, search?: string) {
    const page = await this.models.list(userId, { search, page: 1, limit: 50, kind: 'designed' } as never) as { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const items = Array.isArray(page) ? page : page.items ?? [];
    return {
      models: items.filter((model) => model.status !== 'archived').map((model) => ({
        id: model.id, name: model.name, description: model.description, status: model.status, role: model.role, updatedAt: model.updatedAt,
      })),
    };
  }

  async createModel(actor: AssistantActor, name: string, description?: string) {
    const model = await this.models.create(actor.userId, { name, description });
    return { modelId: model.id, name: model.name, model: this.modelRef(model), editorPath: this.editorPath(model.id), uiTarget: this.uiTarget(model) };
  }

  /**
   * The id of a model named by its id or by its exact name, among the models this person can see.
   * Lets people (and assistants) talk about "the billing model" without ever handling an id.
   */
  async resolveModelId(userId: string, reference: string): Promise<string> {
    const wanted = reference.trim();
    if (UUID.test(wanted)) return wanted;
    const { models } = await this.listModels(userId, wanted);
    const matches = models.filter((model) => normalize(String(model.name ?? '')) === normalize(wanted));
    if (matches.length === 1) return String(matches[0].id);
    if (matches.length > 1) {
      throw new ConflictException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Several models are named "${wanted}"; open the one you mean from the model list`);
    }
    throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, `There is no model named "${wanted}"`);
  }

  /** The model as a person would describe it: concepts with their fields, relationships and sources, by name. */
  async describeModel(userId: string, modelId: string) {
    const model = await this.models.get(userId, modelId);
    const graph = await this.graph.getGraph(userId, modelId) as SemanticGraph;
    const [identity, mappings] = await Promise.all([
      this.identityByConcept(userId, modelId),
      this.listSources(userId, modelId).catch(() => [] as SourceSnapshot[]),
    ]);
    const concepts = graph.nodes.filter((node) => !node.systemKey);
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const freshness = await this.population.freshness(userId, modelId).catch(() => ({ state: 'not_runnable' as const }));
    return {
      model: { id: model.id, name: model.name, description: model.description, status: model.status, role: model.role, editorPath: this.editorPath(model.id) },
      uiTarget: this.uiTarget(model),
      concepts: concepts.map((node) => ({
        key: node.key, label: node.label, description: node.description, category: node.category, recordPolicy: node.recordPolicy,
        fields: node.attributes.map((field) => ({ key: field.key, label: field.label, type: field.type, required: field.required, ...(field.options?.length ? { options: field.options } : {}) })),
        keyFields: identity[node.id] ?? [],
        typedRecords: graph.records.filter((record) => record.nodeTypeId === node.id).length,
      })),
      relations: graph.relations.map((relation) => ({
        key: relation.key, label: relation.label, from: byId.get(relation.sourceNodeTypeId)?.key ?? relation.sourceNodeTypeId,
        to: byId.get(relation.targetNodeTypeId)?.key ?? relation.targetNodeTypeId, cardinality: relation.cardinality,
      })),
      sources: mappings.map((mapping) => ({
        sourceId: mapping.id,
        concept: byId.get(mapping.conceptId)?.key ?? mapping.conceptId,
        kind: mapping.scope === 'workspace' ? 'workspace_documents' : mapping.assetKind === 'document' ? 'document' : 'spreadsheet',
        name: mapping.documentName,
        ...(mapping.sheetName ? { sheet: mapping.sheetName } : {}),
        ...((mapping as { fileCount?: number }).fileCount !== undefined ? { fileCount: (mapping as { fileCount?: number }).fileCount } : {}),
        fields: mapping.fieldMappings.filter((field) => field.mode !== 'ignore').map((field) => field.targetAttribute),
      })),
      data: { freshness: freshness.state },
    };
  }

  async checkModel(userId: string, modelId: string) {
    const graph = await this.graph.getGraph(userId, modelId) as SemanticGraph;
    const issues = this.validation.validate(graph);
    const freshness = await this.population.freshness(userId, modelId).catch(() => ({ state: 'not_runnable' as const }));
    return {
      issues: issues.map((issue) => ({ severity: issue.severity, code: issue.code, target: issue.targetLabel, message: issue.message })),
      data: freshness,
    };
  }

  // ── Designing ─────────────────────────────────────────────────────────────

  /**
   * Add, change and remove concepts, fields, key fields and relationships in one step. With `dryRun`
   * nothing is saved: the result says what would change and what the model check would find.
   */
  async applyChanges(actor: AssistantActor, modelId: string, changes: AssistantModelChanges, dryRun = false) {
    const model = await this.models.requireActiveRole(actor.userId, modelId, ['owner', 'editor']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const before = await this.graph.getGraph(actor.userId, modelId) as SemanticGraph;
    const identityBefore = await this.identityByConcept(actor.userId, modelId);
    const plan = this.plan(before, identityBefore, changes);
    const issues = this.validation.validate(plan.after).map((issue) => ({ severity: issue.severity, target: issue.targetLabel, message: issue.message }));
    const operations = graphDiff(before, plan.after);
    const identityChanged = Object.keys(plan.identity).filter((conceptId) => JSON.stringify(plan.identity[conceptId]) !== JSON.stringify(identityBefore[conceptId] ?? []));
    if (dryRun || (!operations.length && !identityChanged.length)) {
      return { applied: false, dryRun, model: this.modelRef(model), summary: plan.summary, operationCount: operations.length, issues };
    }
    if (operations.length) {
      await this.graph.apply(actor.userId, modelId, { expectedRevision: before.revision, operations: operations as unknown as Record<string, unknown>[] });
    }
    await this.saveIdentity(actor.userId, modelId, identityChanged.map((conceptId) => [conceptId, plan.identity[conceptId]]));
    const changeSet = await this.recordChangeSet(actor, model.id, model.currentDraftVersionId, {
      summary: plan.summary,
      graphForward: operations,
      graphUndo: graphDiff(plan.after, before),
      identityBefore: Object.fromEntries(identityChanged.map((conceptId) => [conceptId, identityBefore[conceptId] ?? []])),
      identityAfter: Object.fromEntries(identityChanged.map((conceptId) => [conceptId, plan.identity[conceptId]])),
    });
    return {
      applied: true, changeId: changeSet, model: this.modelRef(model), summary: plan.summary, operationCount: operations.length, issues,
      editorPath: this.editorPath(model.id), uiTarget: this.uiTarget(model),
    };
  }

  private plan(before: SemanticGraph, identityBefore: Record<string, string[]>, changes: AssistantModelChanges) {
    const graph: SemanticGraph = structuredClone(before);
    const identity: Record<string, string[]> = { ...identityBefore };
    const summary: ChangeSummary = { message: '', added: [], changed: [], removed: [] };
    const concepts = changes.concepts ?? [];
    if (concepts.length > MAX_CONCEPTS_PER_CHANGE) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Change at most ${MAX_CONCEPTS_PER_CHANGE} concepts at a time`);
    }
    const find = (reference: string) => this.findConcept(graph, reference);
    const requireConcept = (reference: string) => {
      const node = find(reference);
      if (!node) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `There is no concept "${reference}" in this model`);
      if (node.systemKey) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `"${node.label}" is built in and cannot be changed`);
      return node;
    };

    // Removals first, so a concept can be replaced by one with the same name.
    for (const reference of changes.removeRelations ?? []) {
      const relation = this.findRelation(graph, reference);
      if (!relation) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `There is no relationship ${reference.label ? `"${reference.label}" ` : ''}from "${reference.from}" to "${reference.to}"`);
      this.removeRelation(graph, relation.id);
      summary.removed.push(`relationship ${relation.label}`);
    }
    for (const reference of changes.removeConcepts ?? []) {
      const node = requireConcept(reference);
      for (const relation of graph.relations.filter((item) => item.sourceNodeTypeId === node.id || item.targetNodeTypeId === node.id)) this.removeRelation(graph, relation.id);
      const recordIds = new Set(graph.records.filter((record) => record.nodeTypeId === node.id).map((record) => record.id));
      graph.recordRelations = graph.recordRelations.filter((link) => !recordIds.has(link.sourceRecordId) && !recordIds.has(link.targetRecordId));
      graph.records = graph.records.filter((record) => !recordIds.has(record.id));
      graph.nodes = graph.nodes.filter((item) => item.id !== node.id);
      delete identity[node.id];
      summary.removed.push(`concept ${node.label}`);
    }

    let placed = 0;
    const origin = this.freeSpot(graph);
    for (const spec of concepts) {
      const reference = spec.concept ?? spec.label;
      if (!reference?.trim()) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Each concept needs a name');
      let node = find(reference);
      if (node?.systemKey) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `"${node.label}" is built in and cannot be changed`);
      if (!node && spec.concept && !spec.label) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `There is no concept "${spec.concept}" in this model`);
      const isNew = !node;
      if (!node) {
        const label = spec.label!.trim();
        node = {
          id: randomUUID(), key: this.uniqueKey(graph.nodes.map((item) => item.key), businessKey(label, 'concept')), label,
          description: spec.description ?? '', category: spec.category ?? 'business_object', recordPolicy: spec.recordPolicy ?? 'optional',
          systemKey: null, aliases: spec.aliases ?? [], attributes: [],
          position: { x: origin.x + (placed % 4) * 300, y: origin.y + Math.floor(placed / 4) * 240 },
        };
        placed += 1;
        graph.nodes.push(node);
      }
      const edits: string[] = [];
      if (!isNew) {
        if (spec.newLabel?.trim() && spec.newLabel.trim() !== node.label) {
          const label = spec.newLabel.trim();
          edits.push(`renamed to ${label}`);
          node.label = label;
          node.key = this.uniqueKey(graph.nodes.filter((item) => item.id !== node!.id).map((item) => item.key), businessKey(label, 'concept'));
        }
        if (spec.description !== undefined && spec.description !== node.description) { node.description = spec.description; edits.push('description'); }
        if (spec.category && spec.category !== node.category) { node.category = spec.category; edits.push('category'); }
        if (spec.recordPolicy && spec.recordPolicy !== node.recordPolicy) { node.recordPolicy = spec.recordPolicy; edits.push('record policy'); }
        if (spec.aliases) node.aliases = spec.aliases;
      }
      for (const reference of spec.removeFields ?? []) {
        const field = this.findField(node, reference);
        if (!field) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${node.label} has no field "${reference}"`);
        node.attributes = node.attributes.filter((item) => item.key !== field.key);
        if (identity[node.id]) identity[node.id] = identity[node.id].filter((key) => key !== field.key);
        edits.push(`removed field ${field.label}`);
      }
      for (const fieldSpec of spec.fields ?? []) {
        const { field, added, changed } = this.upsertField(node, fieldSpec);
        if (added) edits.push(`added field ${field.label}`);
        else if (changed.length) edits.push(`changed field ${field.label} (${changed.join(', ')})`);
      }
      if (spec.keyFields) {
        identity[node.id] = spec.keyFields.map((reference) => {
          const field = this.findField(node!, reference);
          if (!field) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${node!.label} has no field "${reference}" to use as a key field`);
          return field.key;
        });
      }
      if (!isNew && edits.length) summary.changed.push(`${node.label}: ${edits.join(', ')}`);
      if (isNew) summary.added.push(`concept ${node.label}${node.attributes.length ? ` (${node.attributes.length} field${node.attributes.length === 1 ? '' : 's'})` : ''}`);
    }

    for (const spec of changes.relations ?? []) {
      const source = requireConcept(spec.from);
      const target = requireConcept(spec.to);
      const label = spec.label.trim();
      if (!label) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Each relationship needs a name');
      const key = spec.key ? businessKey(spec.key, 'relation') : businessKey(label, 'relation');
      const existing = graph.relations.find((relation) => relation.sourceNodeTypeId === source.id && relation.targetNodeTypeId === target.id
        && (relation.key === key || normalize(relation.label) === normalize(label)));
      if (existing) {
        const updates: string[] = [];
        if (spec.cardinality && spec.cardinality !== existing.cardinality) { existing.cardinality = spec.cardinality; updates.push('cardinality'); }
        if (spec.inverseLabel !== undefined) existing.inverseLabel = spec.inverseLabel;
        if (spec.description !== undefined) existing.description = spec.description;
        if (updates.length) summary.changed.push(`relationship ${existing.label}: ${updates.join(', ')}`);
        continue;
      }
      graph.relations.push({
        id: randomUUID(), key: this.uniqueKey(graph.relations.map((relation) => relation.key), key), label,
        inverseLabel: spec.inverseLabel ?? '', description: spec.description ?? '', sourceNodeTypeId: source.id, targetNodeTypeId: target.id,
        cardinality: spec.cardinality ?? 'one_to_many', traversable: true, filterable: true, attributes: [],
      });
      summary.added.push(`relationship ${source.label} ${label} ${target.label}`);
    }

    summary.message = [
      summary.added.length ? `added ${summary.added.join('; ')}` : '',
      summary.changed.length ? `changed ${summary.changed.join('; ')}` : '',
      summary.removed.length ? `removed ${summary.removed.join('; ')}` : '',
    ].filter(Boolean).join('; ') || 'no change';
    for (const conceptId of Object.keys(identity)) if (!graph.nodes.some((node) => node.id === conceptId)) delete identity[conceptId];
    return { after: graph, identity, summary };
  }

  private upsertField(node: SemanticNodeType, spec: AssistantFieldSpec): { field: AttributeDefinition; added: boolean; changed: string[] } {
    const label = spec.label?.trim();
    if (!label) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Each field of ${node.label} needs a name`);
    if (spec.type && !attributeTypes.includes(spec.type)) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Field type must be one of ${attributeTypes.join(', ')}`);
    }
    const existing = this.findField(node, spec.key ?? label);
    const was: AttributeDefinition | null = existing ? structuredClone(existing) : null;
    const field: AttributeDefinition = existing ?? {
      key: this.uniqueKey(node.attributes.map((item) => item.key), businessKey(spec.key ?? label, 'field')), label, type: spec.type ?? 'text', required: false,
    };
    field.label = label;
    if (spec.type) field.type = spec.type;
    if (spec.required !== undefined) field.required = spec.required;
    if (spec.description !== undefined) field.description = spec.description;
    if (spec.aliases) field.aliases = spec.aliases;
    if (field.type === 'enum') field.options = spec.options ?? field.options ?? [];
    else delete field.options;
    if (!existing) node.attributes = [...node.attributes, field];
    // What an edit of an existing field changed, so the summary does not read "no change".
    const changed = was ? (['label', 'type', 'required', 'description', 'aliases', 'options'] as const)
      .filter((name) => JSON.stringify(was[name] ?? null) !== JSON.stringify(field[name] ?? null)) : [];
    return { field, added: !existing, changed };
  }

  private findConcept(graph: SemanticGraph, reference: string): SemanticNodeType | undefined {
    const wanted = normalize(reference);
    return graph.nodes.find((node) => node.id === reference)
      ?? graph.nodes.find((node) => node.key === wanted || node.key === businessKey(reference, 'concept'))
      ?? graph.nodes.find((node) => normalize(node.label) === wanted);
  }

  private findField(node: SemanticNodeType, reference: string): AttributeDefinition | undefined {
    const wanted = normalize(reference);
    return node.attributes.find((field) => field.key === wanted || field.key === businessKey(reference, 'field'))
      ?? node.attributes.find((field) => normalize(field.label) === wanted);
  }

  private findRelation(graph: SemanticGraph, reference: AssistantRelationRef): SemanticRelationType | undefined {
    const source = this.findConcept(graph, reference.from);
    const target = this.findConcept(graph, reference.to);
    if (!source || !target) return undefined;
    const candidates = graph.relations.filter((relation) => relation.sourceNodeTypeId === source.id && relation.targetNodeTypeId === target.id);
    if (!reference.label) return candidates.length === 1 ? candidates[0] : undefined;
    return candidates.find((relation) => relation.key === businessKey(reference.label!, 'relation') || normalize(relation.label) === normalize(reference.label!));
  }

  private removeRelation(graph: SemanticGraph, relationId: string) {
    graph.recordRelations = graph.recordRelations.filter((link) => link.relationTypeId !== relationId);
    graph.relations = graph.relations.filter((relation) => relation.id !== relationId);
  }

  private uniqueKey(taken: string[], wanted: string): string {
    const used = new Set(taken);
    if (!used.has(wanted)) return wanted;
    for (let index = 2; ; index += 1) if (!used.has(`${wanted}_${index}`)) return `${wanted}_${index}`;
  }

  /** Where new concepts go: below whatever is on the canvas, so nothing overlaps. */
  private freeSpot(graph: SemanticGraph) {
    const positions = graph.nodes.map((node) => node.position).filter(Boolean);
    if (!positions.length) return { x: 120, y: 120 };
    return { x: Math.min(...positions.map((position) => position.x)), y: Math.max(...positions.map((position) => position.y)) + 260 };
  }

  private async identityByConcept(userId: string, modelId: string): Promise<Record<string, string[]>> {
    const rules = await this.crossSource.listIdentityRules(userId, modelId);
    return Object.fromEntries(rules.map((rule) => [rule.conceptId, rule.fields]));
  }

  private async saveIdentity(userId: string, modelId: string, rules: Array<[string, string[]]>) {
    for (const [conceptId, fields] of rules) {
      const model = await this.models.get(userId, modelId);
      await this.crossSource.saveIdentityRule(userId, modelId, conceptId, { expectedRevision: model.revision, fields });
    }
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  async listWorkspaces(userId: string, search?: string) {
    const [own, shared] = await Promise.all([
      this.workspaces.findAllByUser(userId, { page: 1, limit: 50, search }),
      this.workspaceShares.findSharedWithUser(userId, { page: 1, limit: 50 } as never).catch(() => ({ workspaces: [] })),
    ]);
    const term = search?.trim().toLowerCase();
    const sharedItems = (shared.workspaces as Array<{ id: string; name: string }>).filter((workspace) => !term || workspace.name.toLowerCase().includes(term));
    return {
      workspaces: [
        ...own.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, shared: false })),
        ...sharedItems.filter((workspace) => !own.workspaces.some((item) => item.id === workspace.id)).map((workspace) => ({ id: workspace.id, name: workspace.name, shared: true })),
      ],
    };
  }

  async listFiles(userId: string, workspaceId: string, options: { folderId?: string; search?: string; page?: number }) {
    await this.requireWorkspaceAccess(userId, workspaceId);
    const params = { page: options.page ?? 1, limit: 100, ...(options.search ? { search: options.search } : {}) };
    const result = options.folderId
      ? await this.documents.getFolderContents(workspaceId, options.folderId, params)
      : await this.documents.findAllByWorkspace(workspaceId, params);
    return {
      workspaceId,
      files: result.documents.map((document) => ({
        id: document.id,
        name: document.isFolder ? document.folderName || document.originalName : document.originalName,
        kind: document.isFolder ? 'folder' : this.fileKind(document.mimeType),
      })),
      page: result.pagination.page,
      totalPages: result.pagination.totalPages,
    };
  }

  /** Files whose name matches, across every workspace the person can open, with where each one sits. */
  async searchSourceFiles(userId: string, search: string, page = 1) {
    const term = search.trim();
    if (term.length < 2) return { files: [], page: 1, totalPages: 1 };
    const [own, shared] = await Promise.all([
      this.workspaces.findAllByUser(userId, { page: 1, limit: 100 }),
      this.workspaceShares.findSharedWithUser(userId, { page: 1, limit: 100 } as never).catch(() => ({ workspaces: [] })),
    ]);
    const names = new Map<string, string>();
    for (const workspace of [...own.workspaces, ...(shared.workspaces as Array<{ id: string; name: string }>)]) names.set(workspace.id, workspace.name);
    if (!names.size) return { files: [], page: 1, totalPages: 1 };
    const result = await this.documents.findByMultipleWorkspaces([...names.keys()], { page, limit: 50, search: term, sortBy: 'originalName', sortOrder: 'asc' } as never);
    const files = result.documents.filter((document) => !document.isFolder);
    const parents = new Map<string, Promise<string | null>>();
    const folderName = (workspaceId: string, parentId?: string | null) => {
      if (!parentId) return Promise.resolve(null);
      if (!parents.has(parentId)) {
        parents.set(parentId, this.documents.findById(workspaceId, parentId).then((folder) => folder.folderName || folder.originalName).catch(() => null));
      }
      return parents.get(parentId)!;
    };
    return {
      files: await Promise.all(files.map(async (document) => ({
        id: document.id,
        name: document.originalName,
        mimeType: document.mimeType,
        kind: this.fileKind(document.mimeType),
        workspaceId: document.workspaceId,
        workspaceName: names.get(document.workspaceId) ?? '',
        folderName: await folderName(document.workspaceId, document.parentId),
      }))),
      page: result.pagination.page,
      totalPages: result.pagination.totalPages,
    };
  }

  /** The sheets, columns and a few rows of a spreadsheet, read on demand the first time. */
  async profileSpreadsheet(actor: AssistantActor, modelId: string, workspaceId: string, documentId: string, sheetName?: string) {
    await this.ensureWorkspaceLinked(actor.userId, modelId, workspaceId);
    const query = { workspaceId, ...(sheetName ? { sheetName } : {}) };
    try {
      return this.compactProfile(await this.sourceMappings.profileAsset(actor.userId, modelId, workspaceId, documentId, query));
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    const requested = await this.sourceMappings.requestProfile(actor.userId, modelId, workspaceId, documentId, query) as { jobId?: string; id?: string } | undefined;
    const jobId = requested?.jobId ?? requested?.id;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        return this.compactProfile(await this.sourceMappings.profileAsset(actor.userId, modelId, workspaceId, documentId, query));
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
      if (jobId) {
        const job = await this.sourceMappings.discoveryJob(actor.userId, modelId, jobId).catch(() => null) as { state?: string; error?: unknown } | null;
        if (job && ['failed', 'cancelled'].includes(String(job.state))) {
          throw new ConflictException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'The spreadsheet could not be read');
        }
      }
    }
    return { pending: true, message: 'The spreadsheet is still being read. Ask again in a moment.' };
  }

  private compactProfile(profile: Record<string, unknown>) {
    const fields = Array.isArray(profile.fields) ? profile.fields as Array<Record<string, unknown>> : [];
    return {
      sheets: profile.sheets,
      sheet: profile.sheet,
      columns: fields.map((field) => ({
        name: field.name ?? field.field ?? field.column,
        type: field.inferredType ?? field.type,
        filled: field.populatedRatio ?? field.populated,
        unique: field.uniqueRatio ?? field.unique,
      })),
      sampleRows: Array.isArray(profile.sampleRows) ? (profile.sampleRows as unknown[]).slice(0, 5) : [],
      totalRows: profile.totalRows,
    };
  }

  /** Feed a concept from a spreadsheet sheet: each concept field takes one column. */
  async mapSpreadsheet(actor: AssistantActor, modelId: string, input: { concept: string; workspaceId: string; documentId: string; sheetName?: string; columns: Record<string, string>; keyFields?: string[] }) {
    const graph = await this.graph.getGraph(actor.userId, modelId) as SemanticGraph;
    const node = this.requireMappableConcept(graph, input.concept);
    await this.ensureWorkspaceLinked(actor.userId, modelId, input.workspaceId);
    const document = await this.documents.findById(input.workspaceId, input.documentId);
    const csv = document.mimeType.startsWith('text/csv');
    if (!STRUCTURED_MIME_PREFIXES.some((prefix) => document.mimeType.startsWith(prefix))) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${document.originalName} is not a spreadsheet; use map_documents`);
    }
    const fieldMappings = node.attributes.map((field) => {
      const column = Object.entries(input.columns).find(([reference]) => this.findField(node, reference)?.key === field.key)?.[1];
      return column ? { sourceField: column, targetAttribute: field.key, mode: 'direct' as const } : { sourceField: null, targetAttribute: field.key, mode: 'ignore' as const };
    });
    const unknown = Object.keys(input.columns).filter((reference) => !this.findField(node, reference));
    if (unknown.length) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${node.label} has no field ${unknown.map((item) => `"${item}"`).join(', ')}`);
    if (!fieldMappings.some((field) => field.mode === 'direct')) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Map at least one column');
    const identityFields = this.keyFieldKeys(node, input.keyFields) ?? (await this.identityByConcept(actor.userId, modelId))[node.id] ?? [];
    const model = await this.models.get(actor.userId, modelId);
    await this.sourceMappings.create(actor.userId, modelId, {
      expectedRevision: model.revision, conceptId: node.id, workspaceId: input.workspaceId, documentId: input.documentId,
      sheetName: csv ? (input.sheetName || 'CSV') : (input.sheetName ?? ''), assetKind: csv ? 'csv' : 'excel_sheet', fieldMappings, identityFields,
    } as never);
    return this.recordSourceAdded(actor, modelId, node, (mapping) => mapping.documentId === input.documentId, `${document.originalName} feeds ${node.label}`);
  }

  /**
   * Feed a concept from documents: one file, picked files and folders, or a whole workspace. Each concept
   * field is read by AI, by rules, from the document name, or set to a fixed value.
   */
  async mapDocuments(actor: AssistantActor, modelId: string, input: {
    concept: string; workspaceId: string; documentIds?: string[]; folderIds?: string[]; wholeWorkspace?: boolean;
    fields?: Record<string, DocumentFieldMethod>; keyFields?: string[];
  }) {
    const graph = await this.graph.getGraph(actor.userId, modelId) as SemanticGraph;
    const node = this.requireMappableConcept(graph, input.concept);
    await this.ensureWorkspaceLinked(actor.userId, modelId, input.workspaceId);
    const documentIds = [...new Set(input.documentIds ?? [])];
    const folderIds = [...new Set(input.folderIds ?? [])];
    if (!input.wholeWorkspace && !documentIds.length && !folderIds.length) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Pick files, folders, or the whole workspace');
    }
    const unknown = Object.keys(input.fields ?? {}).filter((reference) => !this.findField(node, reference));
    if (unknown.length) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${node.label} has no field ${unknown.map((item) => `"${item}"`).join(', ')}`);
    const fieldMappings = node.attributes.map((field) => {
      const method = Object.entries(input.fields ?? {}).find(([reference]) => this.findField(node, reference)?.key === field.key)?.[1]
        ?? (field.key === 'source_document' ? 'document_name' : 'ai');
      if (typeof method === 'object') return { sourceField: null, targetAttribute: field.key, mode: 'constant' as const, constantValue: method.constant };
      if (method === 'document_name') return { sourceField: 'document_name', targetAttribute: field.key, mode: 'metadata' as const };
      if (method === 'ignore') return { sourceField: null, targetAttribute: field.key, mode: 'ignore' as const };
      return { sourceField: null, targetAttribute: field.key, mode: 'extract' as const, extractionStrategy: method === 'extract' ? 'deterministic' as const : 'ai' as const };
    });
    if (!fieldMappings.some((field) => field.mode !== 'ignore')) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${node.label} needs at least one field to read`);
    const identityFields = this.keyFieldKeys(node, input.keyFields) ?? (await this.identityByConcept(actor.userId, modelId))[node.id] ?? [];
    const model = await this.models.get(actor.userId, modelId);
    if (!input.wholeWorkspace && documentIds.length === 1 && !folderIds.length) {
      const document = await this.documents.findById(input.workspaceId, documentIds[0]);
      if (!DOCUMENT_MIME_TYPES.has(document.mimeType)) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${document.originalName} is not a PDF or Word document`);
      await this.sourceMappings.create(actor.userId, modelId, {
        expectedRevision: model.revision, conceptId: node.id, workspaceId: input.workspaceId, documentId: document.id,
        sheetName: '', assetKind: 'document', fieldMappings, identityFields,
      } as never);
      return this.recordSourceAdded(actor, modelId, node, (mapping) => mapping.documentId === document.id, `${document.originalName} feeds ${node.label}`);
    }
    const result = await this.sourceMappings.createWorkspace(actor.userId, modelId, {
      expectedRevision: model.revision, conceptId: node.id, workspaceId: input.workspaceId,
      ...(input.wholeWorkspace ? {} : { folderIds, documentIds }), fieldMappings, identityFields,
    } as never);
    const saved = await this.recordSourceAdded(actor, modelId, node,
      (mapping) => mapping.scope === 'workspace' && mapping.workspaceId === input.workspaceId && this.sameSelection(mapping, input.wholeWorkspace ? null : { folderIds, documentIds }),
      `documents feed ${node.label}`);
    return { ...saved, fileCount: result.fileCount, stillIndexing: result.waitingCount };
  }

  async removeSource(actor: AssistantActor, modelId: string, sourceId: string) {
    const mappings = await this.listSources(actor.userId, modelId);
    const mapping = mappings.find((item) => item.id === sourceId);
    if (!mapping) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'This source is not part of the model');
    const model = await this.models.get(actor.userId, modelId);
    await this.sourceMappings.delete(actor.userId, modelId, sourceId, model.revision);
    const changeId = await this.recordChangeSet(actor, model.id, model.currentDraftVersionId!, {
      summary: { message: `removed source ${mapping.documentName ?? ''}`.trim(), added: [], changed: [], removed: [`source ${mapping.documentName ?? sourceId}`] },
      sourcesRemoved: [this.snapshot(mapping)],
    });
    return { removed: true, changeId, model: this.modelRef(model) };
  }

  /**
   * Suggest sources for concepts without connecting anything. The person sees the suggestions in the
   * conversation and in the designer, with each workspace's name and how many files it would read,
   * and picks one (or other files), or skips the concept.
   */
  async suggestSources(actor: AssistantActor, modelId: string, items: SourceSuggestionInput[]) {
    const model = await this.models.requireActiveRole(actor.userId, modelId, ['owner', 'editor']);
    if (!items.length) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Suggest sources for at least one concept');
    if (items.length > MAX_SUGGESTED_CONCEPTS) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Suggest sources for at most ${MAX_SUGGESTED_CONCEPTS} concepts at a time`);
    }
    const graph = await this.graph.getGraph(actor.userId, modelId) as SemanticGraph;
    const files = new Map<string, Promise<Awaited<ReturnType<WorkspaceDocumentService['listAllInWorkspace']>>>>();
    const workspaceFiles = (workspaceId: string) => {
      if (!files.has(workspaceId)) files.set(workspaceId, this.documents.listAllInWorkspace(workspaceId));
      return files.get(workspaceId)!;
    };
    const planned: Array<{ node: SemanticNodeType; options: SourceSuggestionOption[]; note: string }> = [];
    for (const item of items) {
      const node = this.findConcept(graph, item.concept);
      if (!node || node.systemKey) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `There is no concept "${item.concept}" in this model`);
      // No option: the person picks the files themselves from the list of their workspaces.
      if ((item.options ?? []).length > MAX_OPTIONS_PER_CONCEPT) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Suggest at most ${MAX_OPTIONS_PER_CONCEPT} sources for ${node.label}`);
      }
      const options: SourceSuggestionOption[] = [];
      for (const option of item.options ?? []) options.push(await this.suggestionOption(actor.userId, option, workspaceFiles));
      planned.push({ node, options, note: item.note?.trim().slice(0, 500) ?? '' });
    }
    for (const { node, options, note } of planned) {
      await this.database.query(
        `INSERT INTO semantic_model.assistant_source_suggestions (model_id, concept_id, concept_key, options, note, status, created_by, agent_id, conversation_id)
         VALUES ($1,$2,$3,$4::jsonb,$5,'pending',$6,$7,$8)
         ON CONFLICT (model_id, concept_key) DO UPDATE SET concept_id=EXCLUDED.concept_id, options=EXCLUDED.options, note=EXCLUDED.note,
           status='pending', created_by=EXCLUDED.created_by, agent_id=EXCLUDED.agent_id, conversation_id=EXCLUDED.conversation_id, updated_at=now()`,
        [model.id, node.id, node.key, JSON.stringify(options), note, actor.userId, actor.agentId ?? null, actor.conversationId ?? null],
      );
    }
    const listed = await this.listSuggestions(actor.userId, modelId);
    const keys = new Set(planned.map(({ node }) => node.key));
    return {
      model: this.modelRef(model),
      suggestions: listed.suggestions.filter((suggestion) => keys.has(suggestion.conceptKey)),
      connected: false,
      uiTarget: this.uiTarget(model, 'semanticModel.sources'),
    };
  }

  /** The model's suggested sources, each with whether the concept got a source since or was skipped. */
  async listSuggestions(userId: string, modelId: string) {
    const model = await this.models.get(userId, modelId);
    const [rows, graph, sources] = await Promise.all([
      this.database.query<SuggestionRow>(
        `SELECT id, concept_id AS "conceptId", concept_key AS "conceptKey", options, note, status, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM semantic_model.assistant_source_suggestions WHERE model_id=$1 ORDER BY created_at, concept_key`, [model.id]),
      this.graph.getGraph(userId, modelId) as Promise<SemanticGraph>,
      this.listSources(userId, modelId).catch(() => [] as SourceSnapshot[]),
    ]);
    const suggestions = rows.rows.flatMap((row) => {
      const node = graph.nodes.find((item) => item.id === row.conceptId) ?? graph.nodes.find((item) => item.key === row.conceptKey);
      if (!node) return [];
      const connected = sources.some((source) => source.conceptId === node.id);
      return [{
        conceptId: node.id, conceptKey: row.conceptKey, conceptLabel: node.label, note: row.note, options: row.options,
        status: connected ? 'connected' as const : row.status, updatedAt: row.updatedAt,
      }];
    });
    return { model: this.modelRef(model), suggestions };
  }

  /** Skip a concept's suggestion (or bring it back), so it no longer asks for attention. */
  async setSuggestionStatus(userId: string, modelId: string, conceptKey: string, status: 'pending' | 'skipped') {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const updated = await this.database.query(
      'UPDATE semantic_model.assistant_source_suggestions SET status=$3, updated_at=now() WHERE model_id=$1 AND concept_key=$2 RETURNING id',
      [model.id, conceptKey, status]);
    if (!updated.rows.length) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'There is no suggested source for this concept');
    return this.listSuggestions(userId, modelId);
  }

  private async suggestionOption(userId: string, option: SourceSuggestionOptionInput,
    workspaceFiles: (workspaceId: string) => ReturnType<WorkspaceDocumentService['listAllInWorkspace']>): Promise<SourceSuggestionOption> {
    await this.requireWorkspaceAccess(userId, option.workspaceId);
    const workspace = await this.workspaces.findById(option.workspaceId);
    const all = await workspaceFiles(option.workspaceId);
    const byId = new Map(all.map((item) => [item.id, item]));
    const folderIds = [...new Set(option.folderIds ?? [])];
    const documentIds = [...new Set(option.documentIds ?? [])];
    const unknown = [...folderIds, ...documentIds].filter((id) => !byId.has(id));
    if (unknown.length) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Some picked files or folders are not in ${workspace.name}`);
    const nameOf = (id: string) => { const item = byId.get(id)!; return item.isFolder ? item.folderName || item.originalName : item.originalName; };
    const reason = option.reason?.trim().slice(0, 300) ?? '';
    const base = { workspaceId: option.workspaceId, workspaceName: workspace.name, folderIds, documentIds, reason,
      folders: folderIds.slice(0, 10).map(nameOf), documents: documentIds.slice(0, 10).map(nameOf) };
    if (!folderIds.length && documentIds.length === 1) {
      const document = byId.get(documentIds[0])!;
      if (STRUCTURED_MIME_PREFIXES.some((prefix) => document.mimeType.startsWith(prefix))) {
        return { ...base, kind: 'spreadsheet', mimeType: document.mimeType, ...(option.sheetName ? { sheetName: option.sheetName } : {}), fileCount: 1, stillIndexing: 0 };
      }
      if (DOCUMENT_MIME_TYPES.has(document.mimeType)) return { ...base, kind: 'document', mimeType: document.mimeType, fileCount: 1, stillIndexing: 0 };
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${document.originalName} is neither a spreadsheet nor a PDF or Word document`);
    }
    const selection = folderIds.length || documentIds.length ? { folderIds, documentIds } : null;
    const covered = await this.sourceMappings.workspaceFiles(option.workspaceId, selection);
    return { ...base, kind: selection ? 'documents' : 'workspace', fileCount: covered.readable.length, stillIndexing: covered.waiting.length };
  }

  private requireMappableConcept(graph: SemanticGraph, reference: string) {
    const node = this.findConcept(graph, reference);
    if (!node || node.systemKey) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `There is no concept "${reference}" in this model`);
    if (!node.attributes.length) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Add fields to ${node.label} before feeding it from a source`);
    return node;
  }

  private keyFieldKeys(node: SemanticNodeType, references?: string[]) {
    if (!references) return undefined;
    return references.map((reference) => {
      const field = this.findField(node, reference);
      if (!field) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${node.label} has no field "${reference}" to use as a key field`);
      return field.key;
    });
  }

  private sameSelection(mapping: SourceSnapshot, selection: { folderIds: string[]; documentIds: string[] } | null) {
    const stored = mapping.selection ?? (mapping.folderId ? { folderIds: [mapping.folderId], documentIds: [] } : null);
    const sorted = (value: { folderIds: string[]; documentIds: string[] } | null) =>
      value && (value.folderIds.length || value.documentIds.length) ? JSON.stringify({ f: [...value.folderIds].sort(), d: [...value.documentIds].sort() }) : 'all';
    return sorted(stored) === sorted(selection);
  }

  private async recordSourceAdded(actor: AssistantActor, modelId: string, node: SemanticNodeType, match: (mapping: SourceSnapshot) => boolean, message: string) {
    const model = await this.models.get(actor.userId, modelId);
    const mapping = (await this.listSources(actor.userId, modelId)).find((item) => item.conceptId === node.id && match(item));
    const changeId = mapping ? await this.recordChangeSet(actor, model.id, model.currentDraftVersionId!, {
      summary: { message: `added source: ${message}`, added: [`source ${mapping.documentName ?? ''}`.trim()], changed: [], removed: [] },
      sourcesAdded: [this.snapshot(mapping)],
    }) : undefined;
    return { sourceId: mapping?.id, name: mapping?.documentName, concept: node.label, changeId, model: this.modelRef(model), uiTarget: this.uiTarget(model) };
  }

  private snapshot(mapping: SourceSnapshot): SourceSnapshot {
    return {
      id: mapping.id, conceptId: mapping.conceptId, workspaceId: mapping.workspaceId, documentId: mapping.documentId, sheetName: mapping.sheetName,
      assetKind: mapping.assetKind, fieldMappings: mapping.fieldMappings, identityFields: mapping.identityFields ?? [],
      scope: mapping.scope, folderId: mapping.folderId ?? null, selection: mapping.selection ?? null, documentName: mapping.documentName,
    };
  }

  private async ensureWorkspaceLinked(userId: string, modelId: string, workspaceId: string) {
    const links = await this.modelWorkspaces.list(userId, modelId) as Array<{ workspaceId: string; enabled: boolean; role: string }>;
    if (links.some((link) => link.workspaceId === workspaceId && link.enabled) && links.some((link) => link.role === 'origin' && link.enabled)) return;
    await this.requireWorkspaceAccess(userId, workspaceId);
    const model = await this.models.get(userId, modelId);
    await this.modelWorkspaces.connect(userId, modelId, { expectedRevision: model.revision, workspaceId, addToDocumentsFallback: false });
  }

  private async requireWorkspaceAccess(userId: string, workspaceId: string) {
    if (!await this.workspaceShares.hasAccess(userId, workspaceId)) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID);
  }

  private fileKind(mimeType: string) {
    if (STRUCTURED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return 'spreadsheet';
    if (DOCUMENT_MIME_TYPES.has(mimeType)) return 'document';
    return 'other';
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  async runUpdate(userId: string, modelId: string) {
    const model = await this.models.get(userId, modelId);
    const result = await this.population.requestRefresh(userId, modelId, { purpose: 'build', scope: { kind: 'model' } }) as Record<string, unknown>;
    return {
      jobId: result.jobId ?? result.id, state: result.state ?? result.status ?? 'queued', sources: result.sourceCount, skipped: result.skipped,
      stillIndexing: result.waitingFiles, model: this.modelRef(model), uiTarget: this.uiTarget(model),
    };
  }

  async runStatus(userId: string, modelId: string, jobId?: string) {
    const job = jobId
      ? await this.population.getJob(userId, modelId, jobId) as unknown as Record<string, unknown>
      : await this.population.activeJob(userId, modelId) as unknown as Record<string, unknown> | null;
    if (!job) return { jobId: null, state: 'none', message: 'No data update is running for this model' };
    const result = (job.result ?? null) as Record<string, unknown> | null;
    const kept = result?.servingDecision === 'keep_previous';
    return {
      jobId: job.jobId ?? jobId, state: job.state, progress: job.progress ?? null, error: job.errorCode ?? null,
      ...(Array.isArray(result?.blockingGapKinds) && result.blockingGapKinds.length ? { missingData: result.blockingGapKinds } : {}),
      ...(kept ? { dataInUseKept: true, message: 'This run is missing data, so the records and graph in use were kept' } : {}),
    };
  }

  /**
   * Stop a data update (the one running now when no id is given). Nothing it read is kept: the
   * data in use stays as it was before the run.
   */
  async stopRun(userId: string, modelId: string, jobId?: string) {
    const target = jobId ?? (await this.population.activeJob(userId, modelId))?.jobId;
    if (!target) return { stopped: false, state: 'none', message: 'No data update is running for this model' };
    const job = await this.population.stopJob(userId, modelId, target);
    const stopping = job.state === 'cancel_requested';
    return {
      jobId: target, state: job.state, stopped: job.state === 'cancelled' || stopping,
      message: job.state === 'cancelled' ? 'The data update was stopped; the data in use did not change'
        : stopping ? 'The data update is stopping; the data in use will not change'
        : RUN_ENDED.has(job.state) ? 'This data update had already ended' : 'The data update could not be stopped',
    };
  }

  async searchRecords(userId: string, modelId: string, concept: string, query?: string, limit = 20) {
    const graph = await this.graph.getGraph(userId, modelId) as SemanticGraph;
    const node = this.findConcept(graph, concept);
    if (!node) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, `There is no concept "${concept}" in this model`);
    const page = await this.population.conceptRecords(userId, modelId, node.id, { q: query, limit: Math.min(Math.max(limit, 1), 50), offset: 0 }) as {
      total: number; records: Array<{ label: string; values: Record<string, unknown>; identity?: Record<string, unknown> }>;
    };
    return { concept: node.label, total: page.total, records: page.records.map((record) => ({ name: record.label, ...record.identity, ...record.values })) };
  }

  /**
   * Records of the model found by key, words and meaning (find_records). They are records the model holds,
   * not documents; notes say plainly when the index is not ready, nothing matched or the model has no such
   * concept, so the assistant does not present a guess as a fact.
   */
  async findRecords(userId: string, modelId: string, input: { query: string; concepts?: string[]; data?: AssistantDataChoice; limit?: number }) {
    const data = input.data ?? 'published';
    const model = await this.models.get(userId, modelId);
    const result = await this.graphSearch.search(userId, modelId, {
      environment: assistantEnvironment(data), query: input.query, concepts: input.concepts, limit: input.limit ?? 10,
    });
    const notes: string[] = [];
    if (result.status === 'index_not_ready') {
      notes.push(`The search index of this data is not ready (${result.index.state}): ${String(result.coverage.indexedCount)} of ${String(result.coverage.expectedCount)} records can be found by meaning. Tell the user that records may be missing.`);
    }
    if (result.status === 'not_represented' || result.unknownConcepts.length) {
      notes.push(`The model has no concept named ${result.unknownConcepts.map((name) => `"${name}"`).join(', ') || 'as asked'}: this information is not in the model.`);
    }
    if (result.status === 'no_match') notes.push('No record of the model matches this search.');
    if (result.modeUsed === 'lexical_only') notes.push('Search by meaning was unavailable: only keys, names and words were matched, so a record worded differently may be missing.');
    if (result.modeUsed === 'exact_only') notes.push('Only exact keys and names were matched.');
    return {
      model: this.modelRef(model), data, status: result.status, searchMode: result.modeUsed, indexState: result.index.state,
      concepts: result.concepts.map((concept) => concept.label), unknownConcepts: result.unknownConcepts,
      records: result.seeds.map((seed) => ({
        entityId: seed.entityId, concept: seed.conceptLabel, name: seed.label, keyFields: seed.keyFields, snippet: seed.snippet,
        match: seed.matchClass, sourceCount: seed.provenance.length,
      })),
      coverage: result.coverage, notes,
    };
  }

  /**
   * The records linked to some records along the model's real relationships (get_related_records): one step,
   * or two when then_relations names the relationships of the second step. A related record is there because
   * of a link, never because it matched anything.
   */
  async relatedRecords(userId: string, modelId: string, input: {
    recordIds: string[]; relations?: string[]; direction?: RuntimeGraphExpandStep['direction']; thenRelations?: string[];
    concepts?: string[]; data?: AssistantDataChoice; maxRecords?: number;
  }) {
    const data = input.data ?? 'published';
    const direction = input.direction ?? 'both';
    const twoSteps = Boolean(input.thenRelations?.length);
    const concepts = input.concepts?.length ? input.concepts : undefined;
    // The concept filter applies to the records returned (the last step), so the records in between stay reachable.
    const steps: RuntimeGraphExpandStep[] = [{
      ...(input.relations?.length ? { relations: input.relations } : {}), direction, ...(!twoSteps && concepts ? { concepts } : {}),
    }];
    if (twoSteps) steps.push({ relations: input.thenRelations, direction, ...(concepts ? { concepts } : {}) });
    const model = await this.models.get(userId, modelId);
    const result = await this.graphSearch.expand(userId, modelId, {
      environment: assistantEnvironment(data), seedEntityIds: input.recordIds, steps, maxNodes: input.maxRecords ?? 50,
    });
    const notes: string[] = [];
    if (result.truncated) notes.push(`The result stopped at ${String(result.nodes.length)} records: more linked records exist. Say that the list is incomplete.`);
    if (result.hiddenSeeds) notes.push(`${String(result.hiddenSeeds)} of the records asked for come from sources the user cannot open, so they and their links are not shown.`);
    if (result.status === 'no_match') notes.push('These records have no links of the kind asked for.');
    if (result.status === 'partial') notes.push('Only part of the links could be followed. Say that the result may be incomplete.');
    return {
      model: this.modelRef(model), data, status: result.status, truncated: result.truncated,
      records: result.nodes.map((node) => ({
        entityId: node.entityId, concept: node.conceptLabel, name: node.label, keyFields: node.keyFields,
        includedBecause: node.inclusionReason === 'seed' ? 'asked_for' : 'linked',
        path: node.path.map((step) => ({ from: step.fromEntityId, relation: step.relationKey, direction: step.direction, to: step.toEntityId })),
      })),
      links: result.edges.map((edge) => ({ relation: edge.relationKey, from: edge.sourceEntityId, to: edge.targetEntityId })),
      notes,
    };
  }

  /**
   * The data's shape for an assistant about to query it (describe_model): concepts with their fields and
   * types, key fields, relationships, and how many records the person can see in each concept, from the
   * version whose data is bound (published unless data=draft).
   */
  async describeData(userId: string, modelId: string, data: AssistantDataChoice = 'published') {
    const model = await this.models.get(userId, modelId);
    const { overview, graph, versionId } = await this.graphSearch.dataOverview(userId, modelId, assistantEnvironment(data));
    const inData = new Map(overview.concepts.map((concept) => [concept.key, concept]));
    const nodes = (graph?.nodes ?? []).filter((node) => !node.systemKey);
    const byId = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
    const notes: string[] = [];
    const concepts: (Record<string, unknown> & { fields: Record<string, unknown>[] })[] = nodes.map((node) => {
      const stored = inData.get(node.key);
      if (!stored) notes.push(`"${node.label}" has no data yet (added after the last data update): it cannot be queried.`);
      else if (stored.hiddenRecords) notes.push(`${String(stored.hiddenRecords)} records of "${node.label}" come from sources the user cannot open: they are not counted or shown.`);
      const queryable = new Set(stored?.fields ?? []);
      return {
        key: node.key, label: node.label, ...(node.description ? { description: node.description } : {}),
        ...(node.aliases.length ? { aliases: node.aliases } : {}),
        recordCount: stored?.recordCount ?? 0, keyFields: stored?.keyFields ?? [],
        fields: node.attributes.map((field) => ({
          ...describeField(field), ...(stored && !queryable.has(field.key) ? { inData: false } : {}),
        })),
      };
    });
    for (const stored of overview.concepts) {
      if (!nodes.some((node) => node.key === stored.key)) {
        concepts.push({ key: stored.key, label: stored.label, recordCount: stored.recordCount, keyFields: stored.keyFields,
          fields: stored.fields.map((key) => ({ key, label: key, type: 'text' })) });
      }
    }
    if (concepts.some((concept) => concept.fields.some((field) => field.inData === false))) {
      notes.push('Fields marked inData: false were added after the last data update: they hold no value yet and cannot be queried.');
    }
    if (versionId && overview.modelVersionId !== versionId) {
      notes.push('The data was built from another version of the model: some definitions may differ from the data.');
    }
    const relations = (graph?.relations ?? []).map((relation) => ({
      key: relation.key, label: relation.label, ...(relation.inverseLabel ? { inverseLabel: relation.inverseLabel } : {}),
      from: byId.get(relation.sourceNodeTypeId)?.key ?? relation.sourceNodeTypeId,
      to: byId.get(relation.targetNodeTypeId)?.key ?? relation.targetNodeTypeId,
      cardinality: relation.cardinality, ...(relation.description ? { description: relation.description } : {}),
    }));
    return { model: this.modelRef(model), data, dataRevisionId: overview.dataRevisionId, concepts, relations, howToQuery: HOW_TO_QUERY, notes };
  }

  /**
   * Records of one concept filtered, counted, grouped or listed (query_records). The assistant plans the
   * query; the result echoes how it was read (field keys, absolute date ranges) and notes say plainly what
   * was left out (unreadable values, hidden records, more groups or pages), so nothing is presented as
   * complete when it is not.
   */
  async queryRecords(userId: string, modelId: string, input: Omit<RecordsQuery, 'environment'> & { data?: AssistantDataChoice }) {
    const { data = 'published', ...query } = input;
    const model = await this.models.get(userId, modelId);
    const result = await this.graphSearch.queryRecords(userId, modelId, { ...query, environment: assistantEnvironment(data) });
    const base = { model: this.modelRef(model), data, status: result.status, appliedQuery: result.appliedQuery };
    if (result.status !== 'ok') {
      const unknownConcept = result.status === 'not_represented';
      return {
        ...base, errors: result.errors ?? [],
        notes: [unknownConcept
          ? `The model has no concept "${input.concept}": this information is not in the model. Its concepts: ${(result.errors?.[0]?.available ?? []).join(', ')}.`
          : 'The query is not valid: fix the parts listed in errors, using the concept and field names from describe_model, and call again.'],
      };
    }
    const notes = queryNotes(result);
    if (result.definitionsVersionId && result.modelVersionId !== result.definitionsVersionId) {
      notes.push('The data was built from another version of the model: field names or types may differ from the data.');
    }
    return { ...base, concept: result.concept?.label, ...queryResultBody(result), notes };
  }

  async publish(userId: string, modelId: string) {
    const model = await this.models.get(userId, modelId);
    const graph = await this.graph.getGraph(userId, modelId) as SemanticGraph;
    const result = await this.versions.publish(userId, modelId, model.revision, graph.revision) as Record<string, unknown>;
    return { published: true, ...result, model: this.modelRef(model), uiTarget: this.uiTarget(model) };
  }

  // ── Change sets ───────────────────────────────────────────────────────────

  private async recordChangeSet(actor: AssistantActor, modelId: string, versionId: string, change: {
    summary: ChangeSummary; graphForward?: SemanticGraphOperation[]; graphUndo?: SemanticGraphOperation[];
    identityBefore?: Record<string, string[]>; identityAfter?: Record<string, string[]>; sourcesAdded?: SourceSnapshot[]; sourcesRemoved?: SourceSnapshot[];
  }): Promise<string> {
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO semantic_model.assistant_change_sets
        (model_id,version_id,actor_user_id,agent_id,conversation_id,summary,graph_forward,graph_undo,identity_before,identity_after,sources_added,sources_removed)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb) RETURNING id`,
      [modelId, versionId, actor.userId, actor.agentId ?? null, actor.conversationId ?? null, JSON.stringify(change.summary),
        JSON.stringify(change.graphForward ?? []), JSON.stringify(change.graphUndo ?? []), JSON.stringify(change.identityBefore ?? {}),
        JSON.stringify(change.identityAfter ?? {}), JSON.stringify(change.sourcesAdded ?? []), JSON.stringify(change.sourcesRemoved ?? [])],
    );
    this.logger.log(`Assistant change ${result.rows[0].id} on model ${modelId}: ${change.summary.message}`);
    return result.rows[0].id;
  }

  /** Recent assistant changes, newest first, with the draft's graph revision so an open editor knows to reload. */
  async listChanges(userId: string, modelId: string, since?: string) {
    const model = await this.models.get(userId, modelId);
    const params: unknown[] = [model.id];
    const after = since && !Number.isNaN(Date.parse(since)) ? ` AND (created_at > $${params.push(new Date(since).toISOString())}::timestamptz OR undone_at > $${params.length}::timestamptz)` : '';
    const rows = await this.database.query<ChangeSetRow>(
      `SELECT ${CHANGE_SET_COLUMNS} FROM semantic_model.assistant_change_sets WHERE model_id=$1${after} ORDER BY created_at DESC LIMIT 20`, params);
    const revision = model.currentDraftVersionId
      ? (await this.database.query<{ revision: number }>('SELECT revision::int FROM semantic_model.versions WHERE id=$1', [model.currentDraftVersionId])).rows[0]?.revision ?? 0
      : 0;
    // A data update someone started from a conversation shows in an open editor, with Stop.
    const activeRun = await this.population.activeJob(userId, modelId).catch(() => null);
    return {
      graphRevision: revision,
      now: new Date().toISOString(),
      activeRun: activeRun ? { jobId: activeRun.jobId, state: activeRun.state } : null,
      changes: rows.rows.map((row) => ({ id: row.id, message: row.summary.message, summary: row.summary, agentId: row.agentId, createdAt: row.createdAt, undoneAt: row.undoneAt })),
    };
  }

  /** Undo one assistant change (the latest one not yet undone when no id is given). */
  async undoChange(actor: AssistantActor, modelId: string, changeId?: string) {
    const change = await this.loadChange(actor.userId, modelId, changeId, 'undo');
    if (change.undoneAt) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT, 'This change was already undone');
    await this.replay(actor.userId, modelId, change.graphUndo, change.identityBefore, change.sourcesAdded, change.sourcesRemoved, (restored) => { change.sourcesRemoved = restored; });
    await this.database.query(
      'UPDATE semantic_model.assistant_change_sets SET undone_at=now(), sources_removed=$2::jsonb WHERE id=$1', [change.id, JSON.stringify(change.sourcesRemoved)]);
    return { undone: true, changeId: change.id, message: change.summary.message, modelId };
  }

  async redoChange(actor: AssistantActor, modelId: string, changeId?: string) {
    const change = await this.loadChange(actor.userId, modelId, changeId, 'redo');
    if (!change.undoneAt) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT, 'This change is not undone');
    await this.replay(actor.userId, modelId, change.graphForward, change.identityAfter, change.sourcesRemoved, change.sourcesAdded, (restored) => { change.sourcesAdded = restored; });
    await this.database.query(
      'UPDATE semantic_model.assistant_change_sets SET undone_at=NULL, sources_added=$2::jsonb WHERE id=$1', [change.id, JSON.stringify(change.sourcesAdded)]);
    return { redone: true, changeId: change.id, message: change.summary.message };
  }

  private async loadChange(userId: string, modelId: string, changeId: string | undefined, direction: 'undo' | 'redo') {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const result = changeId
      ? await this.database.query<ChangeSetRow>(`SELECT ${CHANGE_SET_COLUMNS} FROM semantic_model.assistant_change_sets WHERE model_id=$1 AND id=$2`, [model.id, changeId])
      : await this.database.query<ChangeSetRow>(
        `SELECT ${CHANGE_SET_COLUMNS} FROM semantic_model.assistant_change_sets WHERE model_id=$1 AND undone_at IS ${direction === 'undo' ? 'NULL' : 'NOT NULL'}
         ORDER BY ${direction === 'undo' ? 'created_at' : 'undone_at'} DESC LIMIT 1`, [model.id]);
    const change = result.rows[0];
    if (!change) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, direction === 'undo' ? 'There is no assistant change to undo' : 'There is no undone assistant change to redo');
    if (change.versionId !== model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_VERSION_IMMUTABLE, 'This change belongs to an earlier version of the model');
    return change;
  }

  /** Apply graph operations and key fields, then remove and put back sources. */
  private async replay(userId: string, modelId: string, operations: SemanticGraphOperation[], identity: Record<string, string[]>,
    sourcesToRemove: SourceSnapshot[], sourcesToRestore: SourceSnapshot[], onRestored: (restored: SourceSnapshot[]) => void) {
    const live = await this.listSources(userId, modelId);
    for (const source of sourcesToRemove) {
      const current = live.find((mapping) => mapping.id === source.id)
        ?? live.find((mapping) => mapping.conceptId === source.conceptId && mapping.documentId === source.documentId && mapping.sheetName === source.sheetName);
      if (!current) continue;
      const model = await this.models.get(userId, modelId);
      await this.sourceMappings.delete(userId, modelId, current.id, model.revision);
    }
    if (operations.length) {
      const graph = await this.graph.getGraph(userId, modelId) as SemanticGraph;
      try {
        await this.graph.apply(userId, modelId, { expectedRevision: graph.revision, operations: operations as unknown as Record<string, unknown>[] });
      } catch (error) {
        throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT,
          `The model changed since, so this cannot be reversed automatically: ${(error as Error).message}`);
      }
    }
    const graph = await this.graph.getGraph(userId, modelId) as SemanticGraph;
    await this.saveIdentity(userId, modelId, Object.entries(identity).filter(([conceptId]) => graph.nodes.some((node) => node.id === conceptId)));
    const restored: SourceSnapshot[] = [];
    for (const source of sourcesToRestore) {
      if (!graph.nodes.some((node) => node.id === source.conceptId)) continue;
      const model = await this.models.get(userId, modelId);
      if (source.scope === 'workspace') {
        await this.sourceMappings.createWorkspace(userId, modelId, {
          expectedRevision: model.revision, conceptId: source.conceptId, workspaceId: source.workspaceId,
          folderIds: source.selection?.folderIds ?? (source.folderId ? [source.folderId] : []), documentIds: source.selection?.documentIds ?? [],
          fieldMappings: source.fieldMappings, identityFields: source.identityFields,
        } as never);
      } else {
        await this.sourceMappings.create(userId, modelId, {
          expectedRevision: model.revision, conceptId: source.conceptId, workspaceId: source.workspaceId, documentId: source.documentId,
          sheetName: source.sheetName, assetKind: source.assetKind, fieldMappings: source.fieldMappings, identityFields: source.identityFields,
        } as never);
      }
      const mapping = (await this.listSources(userId, modelId))
        .find((item) => item.conceptId === source.conceptId && item.documentId === source.documentId && item.sheetName === source.sheetName);
      restored.push(mapping ? { ...source, id: mapping.id } : source);
    }
    onRestored(restored.length ? restored : sourcesToRestore);
  }

  private async listSources(userId: string, modelId: string): Promise<SourceSnapshot[]> {
    return await this.sourceMappings.list(userId, modelId) as unknown as SourceSnapshot[];
  }

  private editorPath(modelId: string) {
    return `/semantic-models/${modelId}`;
  }

  private modelRef(model: { id: string; name: string }) {
    return { id: model.id, name: model.name };
  }

  /** A button in the conversation that opens the model, named after it. */
  private uiTarget(model: { id: string; name: string }, surface: AssistantUiTarget['surface'] = 'semanticModel.editor'): AssistantUiTarget {
    return { surface, params: { modelId: model.id, modelName: model.name } };
  }
}
