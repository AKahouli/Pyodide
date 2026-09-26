import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelMappingJob, SemanticModelMappingPlan, SemanticModelMappingProposalResponse } from '../domain/semantic-model-mapping-proposal.types';
import type { SemanticModelEvidenceSearchTask } from '../domain/semantic-model-evidence-search.types';
import { SemanticGraph, type SemanticGraphOperation, type SemanticNodeType } from '../domain/semantic-model.types';
import type { SemanticModelManualInstances } from '../domain/semantic-model-build.types';
import type { SemanticAgeGraphOperation } from '../domain/semantic-age-graph.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import type { AgeGraphOperationsDto } from '../dto';
import { SemanticAgeGraphRepository, type AgeGraphData, type AgeGraphNode } from '../repositories/semantic-age-graph.repository';
import { SemanticGraphCommandService } from './semantic-graph-command.service';
import { SemanticModelEvidenceSearchService } from './semantic-model-evidence-search.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticGraphIndexJobService } from './semantic-graph-index-job.service';
import { SemanticExecutionOwnershipService } from './semantic-execution-ownership.service';

@Injectable()
export class SemanticModelMappingProposalService {
  private readonly logger = new Logger(SemanticModelMappingProposalService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly models: SemanticModelService,
    private readonly graphCommands: SemanticGraphCommandService,
    private readonly evidenceSearch: SemanticModelEvidenceSearchService,
    private readonly db: SemanticModelDatabaseService,
    private readonly ageGraph: SemanticAgeGraphRepository,
    private readonly indexJobs: SemanticGraphIndexJobService,
    private readonly ownership: SemanticExecutionOwnershipService,
  ) {}

  async startAsync(userId: string, modelId: string, manualInstances: SemanticModelManualInstances[] = []): Promise<{ jobId: string; status: 'running' }> {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const jobId = await this.createRun(modelId);
    void this.generate(userId, modelId, manualInstances)
      .then(async (result) => {
        // Store the full evidence tasks in search_summary so applyMappingPlan can resolve source documents later
        await this.updateRun(jobId, { status: 'completed', result, searchSummary: result._evidenceTasks ?? [] });
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Mapping job ${jobId} failed for model ${modelId}: ${message}`);
        await this.updateRun(jobId, { status: 'failed', error: message });
      });
    return { jobId, status: 'running' };
  }

  async getJob(_userId: string, modelId: string, jobId: string): Promise<SemanticModelMappingJob> {
    const row = await this.db.query<{
      id: string; model_id: string; status: string; started_at: string;
      completed_at: string | null; result: SemanticModelMappingProposalResponse | null;
      search_summary: unknown | null; error: string | null;
    }>(
      `SELECT id, model_id, status, started_at, completed_at, result, search_summary, error
       FROM semantic_model.mapping_runs
       WHERE id = $1 AND model_id = $2`,
      [jobId, modelId],
    );
    if (!row.rows.length) {
      throw new NotFoundException(`Mapping job ${jobId} not found`);
    }
    const r = row.rows[0];
    return {
      jobId: r.id,
      modelId: r.model_id,
      status: r.status as SemanticModelMappingJob['status'],
      startedAt: r.started_at,
      ...(r.completed_at ? { completedAt: r.completed_at } : {}),
      ...(r.result ? { result: r.result } : {}),
      ...(r.search_summary ? { evidenceTasks: r.search_summary as SemanticModelMappingJob['evidenceTasks'] } : {}),
      ...(r.error ? { error: r.error } : {}),
    };
  }

  async listJobs(userId: string, modelId: string): Promise<SemanticModelMappingJob[]> {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const rows = await this.db.query<{
      id: string; model_id: string; status: string; started_at: string;
      completed_at: string | null; error: string | null;
    }>(
      `SELECT id, model_id, status, started_at, completed_at, error
       FROM semantic_model.mapping_runs
       WHERE model_id = $1
       ORDER BY started_at DESC
       LIMIT 20`,
      [modelId],
    );
    return rows.rows.map((r) => ({
      jobId: r.id,
      modelId: r.model_id,
      status: r.status as SemanticModelMappingJob['status'],
      startedAt: r.started_at,
      ...(r.completed_at ? { completedAt: r.completed_at } : {}),
      ...(r.error ? { error: r.error } : {}),
    }));
  }

  async generate(userId: string, modelId: string, manualInstances: SemanticModelManualInstances[] = []): Promise<SemanticModelMappingProposalResponse> {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const [graph, search] = await Promise.all([
      this.graphCommands.getGraph(userId, modelId),
      this.evidenceSearch.search(userId, modelId, manualInstances),
    ]);
    const adkUrl = (this.config.get<string>('indexing.apiAdk') || 'http://localhost:8001').replace(/\/$/, '');
    const apiKey = this.config.get<string>('indexing.adkApiKey') || '';
    if (!apiKey) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'ADK_API_KEY is not configured for semantic mapping');
    }
    const searchTasks = search.tasks.map((task) => ({
      bindingId: task.bindingId,
      target: task.target,
      sourceDocumentId: task.sourceDocumentId,
      fileName: task.fileName,
      evidence: task.evidence,
    }));
    // Send existing records so the ADK can recognise already-known entities and return their stable entityKey.
    const existingEntities = graph.records.map((r) => ({
      entityKey: String(r.values['_entity_key'] ?? r.id),
      nodeTypeId: r.nodeTypeId,
      label: r.label,
      attributes: Object.entries(r.values)
        .filter(([k]) => !k.startsWith('_'))
        .map(([key, value]) => ({ key, value })),
    }));
    try {
      const res = await fetch(`${adkUrl}/semantic-model/mappings/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ modelId, graphDesignerCanvas: graph as SemanticGraph, searchTasks, existingEntities, manualInstances }),
        // No timeout: mapping is driven by the async build orchestrator with heartbeat.
        // LLM extraction + native search can legitimately take many minutes on large corpora.
        // (fetch has no deadline unless a signal is set, matching axios `timeout: 0`.)
      });
      if (!res.ok) {
        const body = await res.text();
        let parsed: unknown = body;
        try { parsed = JSON.parse(body) as unknown; } catch { /* non-JSON error body */ }
        const detail = typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed ?? '');
        throw Object.assign(new Error(`HTTP ${res.status}: ${detail}`), { status: res.status, data: parsed });
      }
      const data = await res.json() as SemanticModelMappingPlan;
      return { modelId, generatedAt: new Date().toISOString(), search: search.summary, plan: data, proposals: [], _evidenceTasks: search.tasks };
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      if (typeof status === 'number') {
        const body = (error as { data?: unknown }).data;
        const detail = typeof body === 'object' ? JSON.stringify(body) : String(body ?? (error as Error).message);
        this.logger.error(`Semantic mapping generation failed for model ${modelId}: HTTP ${status}: ${detail}`);
        // 422 from the ADK means partial extraction failure — expose the reason to the caller
        if (status === 422) {
          const adkDetail: string = (body as { detail?: string })?.detail ?? detail;
          if (adkDetail.startsWith('EXTRACTION_PARTIAL_FAILURE:')) {
            throw new ServiceUnavailableException(
              ErrorCode.SERVICE_UNAVAILABLE,
              `Mapping extraction incomplete: too many documents failed to process. ${adkDetail.replace('EXTRACTION_PARTIAL_FAILURE: ', '')}`,
            );
          }
        }
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Semantic mapping generation failed for model ${modelId}: ${msg}`);
      }
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Semantic mapping generation is unavailable');
    }
  }

  async applyMappingPlan(
    userId: string,
    modelId: string,
    jobId: string,
    mode: 'replace' | 'incremental' = 'incremental',
  ): Promise<{ appliedNodeCount: number; appliedEdgeCount: number; updatedNodeCount: number; deletedNodeCount: number; graphViewerWarning: string | null }> {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);

    const job = await this.getJob(userId, modelId, jobId);
    if (job.status !== 'completed' || !job.result?.plan) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Mapping job is not completed');
    }

    let planNodes = [...job.result.plan.nodes];
    const edges = job.result.plan.edges;
    // Incremental mode has nothing to apply when the plan is empty. Replace
    // mode intentionally clears the graph even when extraction found nothing.
    if (!planNodes.length && !edges.length && mode !== 'replace') {
      return { appliedNodeCount: 0, appliedEdgeCount: 0, updatedNodeCount: 0, deletedNodeCount: 0, graphViewerWarning: null };
    }

    const graph = await this.graphCommands.getGraph(userId, modelId);

    // Build reference → source document map from stored evidence tasks.
    // Each entry also carries the workspaceId so records can be traced back
    // to their originating workspaces (a record can come from multiple
    // documents across multiple workspaces).
    const evidenceTasks: SemanticModelEvidenceSearchTask[] = job.evidenceTasks ?? [];
    const refToDoc = new Map<string, { sourceDocumentId: string; fileName: string; workspaceId: string }>();
    for (const task of evidenceTasks) {
      const entry = { sourceDocumentId: task.sourceDocumentId, fileName: task.fileName, workspaceId: task.workspaceId };
      for (const ev of task.evidence) {
        if (ev.reference) refToDoc.set(ev.reference, entry);
      }
      refToDoc.set(task.bindingId, entry);
    }

    // A concept with source-materialized records is authoritative: its
    // instances come from the saved source-document records, never from LLM
    // entity detection. Extracted nodes are used only for attribute enrichment.
    const isMaterializedRecord = (record: (typeof graph.records)[number]) =>
      String(record.values['_source_materialized']).toLowerCase() === 'true';
    const materializedTypeIds = new Set(
      graph.records
        .filter(isMaterializedRecord)
        .map((record) => record.nodeTypeId),
    );
    // Materialized concepts are authoritative. Keep their extracted attributes
    // as optional enrichment, but never keep Semantica's aggregated node as the
    // instance itself: one source document must produce one record.
    const materializedAttributesBySource = new Map<string, SemanticModelMappingPlan['nodes'][number]['attributes']>();
    for (const node of planNodes) {
      if (!materializedTypeIds.has(node.nodeTypeId)) continue;
      for (const reference of node.evidenceReferences ?? []) {
        const source = refToDoc.get(reference);
        if (!source) continue;
        const sourceKey = `${node.nodeTypeId}:${source.workspaceId}:${source.sourceDocumentId}`;
        if (!materializedAttributesBySource.has(sourceKey)) materializedAttributesBySource.set(sourceKey, node.attributes);
      }
    }
    planNodes = planNodes.filter((node) => !materializedTypeIds.has(node.nodeTypeId));

    // Source-materialized records are created explicitly in the graph editor.
    // They are authoritative and must survive replace runs even when the
    // current search/corpus does not emit a matching evidence task.
    if (mode === 'replace' || materializedTypeIds.size > 0) {
      const represented = new Set<string>();
      for (const node of planNodes) {
        for (const reference of node.evidenceReferences ?? []) {
          const source = refToDoc.get(reference);
          if (source) represented.add(`${node.nodeTypeId}:${source.workspaceId}:${source.sourceDocumentId}`);
        }
      }
      for (const record of graph.records) {
        if (!materializedTypeIds.has(record.nodeTypeId)) continue;
        const sourceIds = Array.isArray(record.values['_source_document_ids'])
          ? record.values['_source_document_ids'].map(String)
          : typeof record.values['_source_document_id'] === 'string' ? [record.values['_source_document_id']] : [];
        const workspaceIds = Array.isArray(record.values['_source_workspace_ids'])
          ? record.values['_source_workspace_ids'].map(String)
          : typeof record.values['_source_workspace_id'] === 'string' ? [record.values['_source_workspace_id']] : [];
        const sourcePairs = sourceIds
          .map((sourceId, index) => ({ sourceId, workspaceId: workspaceIds[index] ?? '', index }))
          .filter((pair) => pair.sourceId.length > 0);
        if (!sourcePairs.length) continue;
        if (sourcePairs.every((pair) => represented.has(`${record.nodeTypeId}:${pair.workspaceId}:${pair.sourceId}`))) continue;
        for (const { sourceId, workspaceId, index } of sourcePairs) {
          const sourceKey = `${record.nodeTypeId}:${workspaceId}:${sourceId}`;
          const syntheticReference = `materialized:${record.id}:${index}`;
          refToDoc.set(syntheticReference, {
            sourceDocumentId: sourceId,
            fileName: (Array.isArray(record.values['_source_file_names']) ? record.values['_source_file_names'][index] : record.values['_source_file_name']) as string || record.label,
            workspaceId,
          });
          const evidenceReferences = [
            ...evidenceTasks
              .filter((task) => task.sourceDocumentId === sourceId && task.workspaceId === workspaceId)
              .map((task) => task.bindingId),
            syntheticReference,
          ];
          const attributes = materializedAttributesBySource.get(sourceKey) ?? Object.entries(record.values)
            .filter(([key, value]) => !key.startsWith('_') && value !== null && value !== undefined && ['string', 'number', 'boolean'].includes(typeof value))
            .map(([key, value]) => ({ key, value: value as string | number | boolean, evidenceReferences }));
          planNodes.push({
            id: `preserved-${record.id}-${index}`,
            nodeTypeId: record.nodeTypeId,
            label: (Array.isArray(record.values['_source_file_names']) ? record.values['_source_file_names'][index] : record.values['_source_file_name']) as string || record.label,
            entityKey: index === 0 ? record.id : `${record.id}:${index}`,
            attributes,
            evidenceReferences,
            confidence: 1,
          });
          represented.add(sourceKey);
        }
      }
    }

    const buildValues = (node: SemanticModelMappingPlan['nodes'][number]): Record<string, unknown> => {
      const values: Record<string, unknown> = {};
      for (const attr of node.attributes) values[attr.key] = attr.value;
      const sourceDocs = new Map<string, string>();
      const sourceWorkspaces = new Set<string>();
      for (const ref of node.evidenceReferences ?? []) {
        const doc = refToDoc.get(ref);
        if (!doc) continue;
        sourceDocs.set(doc.sourceDocumentId, doc.fileName);
        if (doc.workspaceId) sourceWorkspaces.add(doc.workspaceId);
      }
      values['_source_document_id'] = sourceDocs.size > 0 ? [...sourceDocs.keys()][0] : null;
      values['_source_file_name'] = sourceDocs.size > 0 ? [...sourceDocs.values()][0] : null;
      values['_source_document_ids'] = [...sourceDocs.keys()];
      values['_source_file_names'] = [...sourceDocs.values()];
      // Workspace traceability: a record can originate from one or many workspaces.
      // Store the full list; keep _source_workspace_id as a convenience shortcut to the first one.
      values['_source_workspace_ids'] = [...sourceWorkspaces];
      values['_source_workspace_id'] = sourceWorkspaces.size > 0 ? [...sourceWorkspaces][0] : null;
      if (materializedTypeIds.has(node.nodeTypeId) && sourceDocs.size > 0) values['_source_materialized'] = true;
      return values;
    };

    const tempToRealId = new Map<string, string>();
    const existingRecordIds = new Set(graph.records.map((record) => record.id));
    const replacedRecordIds = new Map<string, string>();
    const resolveEdgeRecordId = (nodeId: string): string | undefined =>
      tempToRealId.get(nodeId) ?? replacedRecordIds.get(nodeId) ?? (existingRecordIds.has(nodeId) ? nodeId : undefined);
    const operations: Record<string, unknown>[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    if (mode === 'incremental') {
      // Identity resolution — 3 levels, ordered by reliability:
      //
      // Level 1 — Source Document ID overlap (business_object only)
      //   The extractor produces exactly one node per (concept × document).
      //   A document UUID never changes → if the same doc produced a record before,
      //   any new extraction from that doc is the same entity. No LLM dependency.
      //
      // Level 2 — Normalised label (classification / catalog concepts)
      //   For tag-like concepts (Skill, Department…) the label IS the natural key.
      //   Also serves as fallback for business_object when no source doc is stored.
      //
      // Level 3 — _entity_key UUID (last resort / safety net)
      //   Stable UUID assigned at creation. Matched via the ADK's entity recognition.
      //   Catches edge cases not covered by levels 1 and 2.

      const nodeTypeMap = new Map(graph.nodes.map((n) => [n.id, n]));

      // Index: nodeTypeId:sourceDocumentId → record  (one entry per docId per record)
      const currentByDocId = new Map<string, (typeof graph.records)[0]>();
      // Index: nodeTypeId:normalised_label → record
      const currentByLabelKey = new Map<string, (typeof graph.records)[0]>();
      // Index: _entity_key → record
      const currentByEntityKey = new Map<string, (typeof graph.records)[0]>();

      for (const record of graph.records) {
        // Level 1 index — source document IDs
        const docIds = Array.isArray(record.values['_source_document_ids'])
          ? (record.values['_source_document_ids'] as string[])
          : [];
        for (const docId of docIds) {
          const dk = `${record.nodeTypeId}:${docId}`;
          if (!currentByDocId.has(dk)) currentByDocId.set(dk, record);
        }

        // Level 2 index — label
        const lk = `${record.nodeTypeId}:${record.label.toLowerCase().trim()}`;
        if (!currentByLabelKey.has(lk)) currentByLabelKey.set(lk, record);

        // Level 3 index — _entity_key
        const ek = String(record.values['_entity_key'] ?? record.id);
        currentByEntityKey.set(ek, record);
      }

      // Step 1 — resolve each plan node against existing records
      const seenRecordIds = new Set<string>();

      for (const node of planNodes) {
        const values = buildValues(node);
        const nodeDocIds = Array.isArray(values['_source_document_ids'])
          ? (values['_source_document_ids'] as string[])
          : [];
        const isBusinessObject = nodeTypeMap.get(node.nodeTypeId)?.category === 'business_object';

        let existing: (typeof graph.records)[0] | undefined;
        let matchedBy = 'none';

        // Level 1 — source document overlap (business_object only)
        // Guard: a record already claimed by a previous plan node in this batch
        // is excluded — prevents multiple catalog nodes from the same document
        // all collapsing onto the first existing record in the index.
        if (isBusinessObject) {
          for (const docId of nodeDocIds) {
            const candidate = currentByDocId.get(`${node.nodeTypeId}:${docId}`);
            if (candidate && !seenRecordIds.has(candidate.id)) { existing = candidate; matchedBy = 'source_document'; break; }
          }
        }

        // Level 2 — normalised label
        if (!existing) {
          const lk = `${node.nodeTypeId}:${node.label.toLowerCase().trim()}`;
          existing = currentByLabelKey.get(lk);
          if (existing) matchedBy = 'label';
        }

        // Level 3 — _entity_key UUID (ADK recognition or legacy records)
        if (!existing && node.entityKey) {
          existing = currentByEntityKey.get(node.entityKey);
          if (existing) matchedBy = 'entity_key';
        }

        if (existing) {
          values['_entity_key'] = String(existing.values['_entity_key'] ?? existing.id);
          tempToRealId.set(node.id, existing.id);
          seenRecordIds.add(existing.id);
          operations.push({ type: 'record.update', id: existing.id, changes: { label: node.label, values, status: 'active' } });
          updatedCount++;
          this.logger.debug(`[incremental] UPDATE "${node.label}" matched by [${matchedBy}] → ${existing.id}`);
        } else {
          const realId = randomUUID();
          values['_entity_key'] = realId;
          tempToRealId.set(node.id, realId);
          operations.push({ type: 'record.create', entity: { id: realId, nodeTypeId: node.nodeTypeId, label: node.label, values, status: 'active', position: { x: 0, y: 0 } } });
          createdCount++;
          this.logger.debug(`[incremental] CREATE "${node.label}" (${node.nodeTypeId})`);
        }
      }

      // Step 2 — relations: delete stale ones first, then create new ones
      const expectedRelKeys = new Set<string>();
      const createdRelKeys = new Set<string>(); // deduplicate within-batch creates
      const newRelOps: Record<string, unknown>[] = [];

      for (const edge of edges) {
        const sourceRecordId = resolveEdgeRecordId(edge.sourceNodeId);
        const targetRecordId = resolveEdgeRecordId(edge.targetNodeId);
        if (!sourceRecordId || !targetRecordId) continue;

        const relKey = `${edge.relationTypeId}:${sourceRecordId}:${targetRecordId}`;
        expectedRelKeys.add(relKey);

        const alreadyExists = graph.recordRelations.some(
          (r) => r.relationTypeId === edge.relationTypeId && r.sourceRecordId === sourceRecordId && r.targetRecordId === targetRecordId,
        );
        if (!alreadyExists && !createdRelKeys.has(relKey)) {
          createdRelKeys.add(relKey);
          newRelOps.push({ type: 'record_relation.create', entity: { id: randomUUID(), relationTypeId: edge.relationTypeId, sourceRecordId, targetRecordId, values: {} } });
        }
      }

      // Delete only relations not present in new plan (records are never auto-deleted in incremental mode)
      for (const rel of graph.recordRelations) {
        const relKey = `${rel.relationTypeId}:${rel.sourceRecordId}:${rel.targetRecordId}`;
        if (!expectedRelKeys.has(relKey)) {
          operations.push({ type: 'record_relation.delete', id: rel.id });
        }
      }
      // Create new relations last
      operations.push(...newRelOps);

    } else {
      // replace mode — full wipe and re-insert
      for (const rel of graph.recordRelations) operations.push({ type: 'record_relation.delete', id: rel.id });
      for (const record of graph.records) { operations.push({ type: 'record.delete', id: record.id }); deletedCount++; }

      for (const node of planNodes) {
        const realId = randomUUID();
        const vals = buildValues(node);
        vals['_entity_key'] = realId;
        tempToRealId.set(node.id, realId);
        if (node.entityKey) replacedRecordIds.set(node.entityKey, realId);
        operations.push({ type: 'record.create', entity: { id: realId, nodeTypeId: node.nodeTypeId, label: node.label, values: vals, status: 'active', position: { x: 0, y: 0 } } });
        createdCount++;
      }
      for (const edge of edges) {
        const sourceRecordId = resolveEdgeRecordId(edge.sourceNodeId);
        const targetRecordId = resolveEdgeRecordId(edge.targetNodeId);
        if (!sourceRecordId || !targetRecordId) continue;
        operations.push({ type: 'record_relation.create', entity: { id: randomUUID(), relationTypeId: edge.relationTypeId, sourceRecordId, targetRecordId, values: {} } });
      }
    }

    await this.graphCommands.apply(userId, modelId, { expectedRevision: graph.revision, operations } as never);

    const vertexCount = 0, edgeCount = 0, failedVertexCount = 0, failedEdgeCount = 0;

    const ageHadFailures = failedVertexCount > 0 || failedEdgeCount > 0;
    if (ageHadFailures) {
      this.logger.error(
        `AGE graph partially rebuilt for model ${modelId}: ` +
        `${failedVertexCount} vertices and ${failedEdgeCount} edges failed. ` +
        `Relational data is intact.`,
      );
    } else {
      this.logger.log(
        `Mapping plan applied [${mode}] for model ${modelId}: ` +
        `+${createdCount} created, ~${updatedCount} updated, -${deletedCount} deleted. ` +
        `AGE graph: ${vertexCount} vertices, ${edgeCount} edges`,
      );
    }

    const graphViewerWarning = ageHadFailures
      ? `Le graphe a été sauvegardé mais la vue graphe est incomplète (${failedVertexCount} nœuds et ${failedEdgeCount} relations n'ont pas pu être écrits). Les données sont intactes — réessayez pour reconstruire le viewer.`
      : null;

    return { appliedNodeCount: createdCount, updatedNodeCount: updatedCount, deletedNodeCount: deletedCount, appliedEdgeCount: operations.filter((o) => o['type'] === 'record_relation.create').length, graphViewerWarning };
  }

  async getAgeGraph(userId: string, modelId: string): Promise<AgeGraphData> {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);

    // Load relational graph only for _meta enrichment (attribute definitions + values for the detail panel)
    const graph = await this.graphCommands.getGraph(userId, modelId);
    const nodeTypeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    const recordMap = new Map(graph.records.map((r) => [r.id, r]));

    const buildMeta = (nodeId: string, ageLabel?: string) => {
      const record = recordMap.get(nodeId);
      const nodeType = record ? nodeTypeMap.get(record.nodeTypeId) : undefined;
      return {
        nodeTypeLabel: nodeType?.label ?? ageLabel ?? 'Node',
        attributes: (nodeType?.attributes ?? []).map((attr) => ({
          key: attr.key,
          label: attr.label,
          value: record?.values[attr.key] ?? null,
        })),
      };
    };

    // Read exclusively from AGE — no fallback to relational tables.
    // Keep only AGE vertices that still have a relational record, ignoring stale projections.
    const ageData = await this.ageGraph.readGraph(modelId);
    const nodes: AgeGraphNode[] = ageData.nodes
      .filter((n) => recordMap.has(n.id))
      .map((n) => ({
        ...n,
        properties: { ...n.properties, _meta: buildMeta(n.id, n.label) },
      }));
    const liveNodeIds = new Set(nodes.map((n) => n.id));
    const edges = ageData.edges.filter((e) => liveNodeIds.has(e.sourceId) && liveNodeIds.has(e.targetId));
    return { nodes, edges };
  }

  async rebuildAgeGraph(userId: string, modelId: string): Promise<{ vertexCount: number; edgeCount: number; failedVertexCount: number; failedEdgeCount: number; graphViewerWarning: string | null }> {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    await this.ownership.assertLegacyWriteAllowed(modelId, 'AGE rebuild');
    const result = { vertexCount: 0,edgeCount: 0,failedVertexCount: 0,failedEdgeCount: 0 };
    const graphViewerWarning = result.failedVertexCount || result.failedEdgeCount
      ? `Le graphe AGE est incomplet (${result.failedVertexCount} nœud(s) et ${result.failedEdgeCount} relation(s) non écrits).`
      : null;
    await this.indexJobs.enqueue(modelId);
    return { ...result, graphViewerWarning };
  }

  async indexAgeGraph(userId: string, modelId: string): Promise<{ queued: true }> {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    await this.ownership.assertLegacyWriteAllowed(modelId, 'AGE indexing');
    await this.indexJobs.enqueue(modelId);
    return { queued: true };
  }

  async applyAgeGraphOperations(userId: string, modelId: string, dto: AgeGraphOperationsDto) {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    await this.ownership.assertLegacyWriteAllowed(modelId, 'AGE operations');
    const graph = await this.graphCommands.getGraph(userId, modelId);
    const operations = dto.operations.map((operation) => this.parseAgeGraphOperation(operation, graph));
    const expandedOperations: SemanticGraphOperation[] = [];
    const deletedRecordIds = new Set<string>();
    const deletedRelationIds = new Set<string>();
    let createdNodeCount = 0;
    for (const operation of operations) {
      if (operation.type === 'node.delete') {
        for (const relation of graph.recordRelations) {
          if ((relation.sourceRecordId === operation.nodeId || relation.targetRecordId === operation.nodeId) && !deletedRelationIds.has(relation.id)) {
            expandedOperations.push({ type: 'record_relation.delete', id: relation.id });
            deletedRelationIds.add(relation.id);
          }
        }
        if (!deletedRecordIds.has(operation.nodeId)) {
          expandedOperations.push({ type: 'record.delete', id: operation.nodeId });
          deletedRecordIds.add(operation.nodeId);
        }
      } else if (operation.type === 'edge.delete') {
        if (!deletedRelationIds.has(operation.edgeId)) {
          expandedOperations.push({ type: 'record_relation.delete', id: operation.edgeId });
          deletedRelationIds.add(operation.edgeId);
        }
      } else if (operation.type === 'node.create') {
        expandedOperations.push({
          type: 'record.create',
          entity: { id: randomUUID(), nodeTypeId: operation.nodeTypeId, label: operation.label, values: operation.values, status: 'active', position: { x: 0, y: 0 } },
        });
        createdNodeCount++;
      } else {
        expandedOperations.push({
          type: 'record_relation.create',
          entity: { id: randomUUID(), relationTypeId: operation.relationTypeId, sourceRecordId: operation.sourceId, targetRecordId: operation.targetId, values: {} },
        });
      }
    }
    if (!expandedOperations.length) {
      return { appliedNodeCount: 0, appliedEdgeCount: 0, deletedNodeCount: 0, deletedEdgeCount: 0, graphViewerWarning: null };
    }
    await this.graphCommands.apply(userId, modelId, { expectedRevision: graph.revision, operations: expandedOperations } as never);
    const ageResult = { failedVertexCount: 0,failedEdgeCount: 0 };
    const graphViewerWarning = ageResult.failedVertexCount || ageResult.failedEdgeCount
      ? `Le graphe AGE est incomplet (${ageResult.failedVertexCount} nœud(s) et ${ageResult.failedEdgeCount} relation(s) non écrits).`
      : null;
    return {
      appliedNodeCount: createdNodeCount,
      appliedEdgeCount: operations.filter((operation) => operation.type === 'edge.create').length,
      deletedNodeCount: operations.filter((operation) => operation.type === 'node.delete').length,
      deletedEdgeCount: operations.filter((operation) => operation.type === 'edge.delete').length,
      graphViewerWarning,
    };
  }

  private parseAgeGraphOperation(input: Record<string, unknown>, graph: SemanticGraph): SemanticAgeGraphOperation {
    const type = input.type;
    if (type === 'node.create') {
      const nodeTypeId = this.requireAgeId(input.nodeTypeId, 'nodeTypeId');
      const nodeType = graph.nodes.find((node) => node.id === nodeTypeId);
      if (!nodeType || nodeType.systemKey) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'The selected concept cannot contain records');
      }
      return {
        type,
        nodeTypeId,
        label: this.requireAgeText(input.label, 'label'),
        values: this.requireAgeValues(input.values, nodeType),
      };
    }
    if (type === 'node.delete') {
      const nodeId = this.requireAgeId(input.nodeId, 'nodeId');
      if (!graph.records.some((record) => record.id === nodeId)) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'The selected graph node does not exist');
      return { type, nodeId };
    }
    if (type === 'edge.create') {
      const relationTypeId = this.requireAgeId(input.relationTypeId, 'relationTypeId');
      const sourceId = this.requireAgeId(input.sourceId, 'sourceId');
      const targetId = this.requireAgeId(input.targetId, 'targetId');
      const relation = graph.relations.find((candidate) => candidate.id === relationTypeId);
      const source = graph.records.find((record) => record.id === sourceId);
      const target = graph.records.find((record) => record.id === targetId);
      if (!relation || !source || !target || relation.sourceNodeTypeId !== source.nodeTypeId || relation.targetNodeTypeId !== target.nodeTypeId) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'The selected records do not follow this relationship');
      }
      return {
        type,
        relationTypeId,
        sourceId,
        targetId,
      };
    }
    if (type === 'edge.delete') {
      const edgeId = this.requireAgeId(input.edgeId, 'edgeId');
      if (!graph.recordRelations.some((relation) => relation.id === edgeId)) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'The selected graph relationship does not exist');
      return { type, edgeId };
    }
    throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Unsupported AGE graph operation');
  }

  private requireAgeText(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${field} is invalid`);
    }
    return value.trim();
  }

  private requireAgeValues(value: unknown, nodeType: SemanticNodeType): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'values must be an object');
    }
    const input = value as Record<string, unknown>;
    const allowed = new Set(nodeType.attributes.map((attribute) => attribute.key));
    const reserved = new Set(['_source_document_id', '_source_file_name', '_source_document_ids']);
    if (Object.keys(input).some((key) => !allowed.has(key) && !reserved.has(key))) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'values contains an unknown attribute');
    }
    for (const key of reserved) {
      const current = input[key];
      if (current !== undefined && typeof current !== 'string' && !(key === '_source_document_ids' && Array.isArray(current) && current.every((item) => typeof item === 'string'))) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Invalid source document value: ${key}`);
      }
    }
    for (const attribute of nodeType.attributes) {
      const current = input[attribute.key];
      if (attribute.required && (current === undefined || current === null || current === '')) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Required attribute missing: ${attribute.label}`);
      }
      if (current !== undefined && current !== null && !['string', 'number', 'boolean'].includes(typeof current)) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Invalid value for attribute: ${attribute.label}`);
      }
      if (typeof current === 'number' && !Number.isFinite(current)) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Invalid numeric value for attribute: ${attribute.label}`);
      }
    }
    return input;
  }

  private requireAgeId(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${field} is invalid`);
    }
    return value;
  }

  private async createRun(modelId: string): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO semantic_model.mapping_runs (model_id, status, started_at)
       VALUES ($1, 'running', now())
       RETURNING id`,
      [modelId],
    );
    return result.rows[0].id;
  }

  private async updateRun(
    jobId: string,
    patch: { status: 'completed'; result: SemanticModelMappingProposalResponse; searchSummary: unknown }
          | { status: 'failed'; error: string },
  ): Promise<void> {
    if (patch.status === 'completed') {
      await this.db.query(
        `UPDATE semantic_model.mapping_runs
         SET status = 'completed', completed_at = now(), result = $2, search_summary = $3
         WHERE id = $1`,
        [jobId, JSON.stringify(patch.result), JSON.stringify(patch.searchSummary)],
      );
    } else {
      await this.db.query(
        `UPDATE semantic_model.mapping_runs
         SET status = 'failed', completed_at = now(), error = $2
         WHERE id = $1`,
        [jobId, patch.error],
      );
    }
  }
}
