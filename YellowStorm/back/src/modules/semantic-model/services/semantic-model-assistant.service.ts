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

/**
 * What an assistant (an agent using the semantic model MCP) can do to a model, as the person it acts for.
 * Concepts, fields and relationships are named by their business names, never by internal ids. Every
 * change an assistant makes is recorded as one change set that people can see in the editor and undo.
 */

export type Cardinality = SemanticRelationType['cardinality'];

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

const MAX_CONCEPTS_PER_CHANGE = 60;
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
    return { modelId: model.id, name: model.name, editorPath: this.editorPath(model.id) };
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
      return { applied: false, dryRun, summary: plan.summary, operationCount: operations.length, issues };
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
    return { applied: true, changeId: changeSet, summary: plan.summary, operationCount: operations.length, issues, editorPath: this.editorPath(model.id) };
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
        const { field, added } = this.upsertField(node, fieldSpec);
        if (added) edits.push(`added field ${field.label}`);
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

  private upsertField(node: SemanticNodeType, spec: AssistantFieldSpec): { field: AttributeDefinition; added: boolean } {
    const label = spec.label?.trim();
    if (!label) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Each field of ${node.label} needs a name`);
    if (spec.type && !attributeTypes.includes(spec.type)) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Field type must be one of ${attributeTypes.join(', ')}`);
    }
    const existing = this.findField(node, spec.key ?? label);
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
    return { field, added: !existing };
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
    return { removed: true, changeId };
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
    return { sourceId: mapping?.id, name: mapping?.documentName, concept: node.label, changeId };
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
    const result = await this.population.requestRefresh(userId, modelId, { purpose: 'build', scope: { kind: 'model' } }) as Record<string, unknown>;
    return { jobId: result.jobId ?? result.id, state: result.state ?? 'queued', sources: result.sourceCount, skipped: result.skipped, stillIndexing: result.waitingFiles };
  }

  async runStatus(userId: string, modelId: string, jobId: string) {
    const job = await this.population.getJob(userId, modelId, jobId) as unknown as Record<string, unknown>;
    return { jobId, state: job.state, progress: job.progress ?? null, error: job.error ?? null };
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

  async publish(userId: string, modelId: string) {
    const model = await this.models.get(userId, modelId);
    const graph = await this.graph.getGraph(userId, modelId) as SemanticGraph;
    const result = await this.versions.publish(userId, modelId, model.revision, graph.revision) as Record<string, unknown>;
    return { published: true, ...result };
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
    return {
      graphRevision: revision,
      now: new Date().toISOString(),
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
    return { undone: true, changeId: change.id, message: change.summary.message };
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
}
