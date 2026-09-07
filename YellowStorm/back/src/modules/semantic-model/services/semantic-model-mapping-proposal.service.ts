import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { BadRequestException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelMappingJob, SemanticModelMappingPlan, SemanticModelMappingProposalResponse } from '../domain/semantic-model-mapping-proposal.types';
import type { SemanticModelEvidenceSearchTask } from '../domain/semantic-model-evidence-search.types';
import { SemanticGraph } from '../domain/semantic-model.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import type { SemanticModelManualInstances } from '../domain/semantic-model-build.types';
import { SemanticAgeGraphRepository, type AgeGraphData, type AgeGraphNode } from '../repositories/semantic-age-graph.repository';
import { SemanticGraphCommandService } from './semantic-graph-command.service';
import { SemanticModelEvidenceSearchService } from './semantic-model-evidence-search.service';
import { SemanticModelService } from './semantic-model.service';

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
      this.evidenceSearch.search(userId, modelId),
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
      const { data } = await axios.post<SemanticModelMappingPlan>(
        `${adkUrl}/semantic-model/mappings/generate`,
        { modelId, graphDesignerCanvas: graph as SemanticGraph, searchTasks, existingEntities, manualInstances },
        // No timeout: mapping is driven by the async build orchestrator with heartbeat.
        // LLM extraction + native search can legitimately take many minutes on large corpora.
        { headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, timeout: 0 },
      );
      return { modelId, generatedAt: new Date().toISOString(), search: search.summary, plan: data, proposals: [], _evidenceTasks: search.tasks };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const body = error.response?.data;
        const detail = typeof body === 'object' ? JSON.stringify(body) : String(body ?? error.message);
        this.logger.error(`Semantic mapping generation failed for model ${modelId}: HTTP ${status ?? 'timeout'}: ${detail}`);
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

    const { nodes, edges } = job.result.plan;
    if (!nodes.length && !edges.length) {
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

    const buildValues = (node: typeof nodes[0]): Record<string, unknown> => {
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
      return values;
    };

    const tempToRealId = new Map<string, string>();
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

      for (const node of nodes) {
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
        const sourceRecordId = tempToRealId.get(edge.sourceNodeId);
        const targetRecordId = tempToRealId.get(edge.targetNodeId);
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

      for (const node of nodes) {
        const realId = randomUUID();
        const vals = buildValues(node);
        vals['_entity_key'] = realId;
        tempToRealId.set(node.id, realId);
        operations.push({ type: 'record.create', entity: { id: realId, nodeTypeId: node.nodeTypeId, label: node.label, values: vals, status: 'active', position: { x: 0, y: 0 } } });
        createdCount++;
      }
      for (const edge of edges) {
        const sourceRecordId = tempToRealId.get(edge.sourceNodeId);
        const targetRecordId = tempToRealId.get(edge.targetNodeId);
        if (!sourceRecordId || !targetRecordId) continue;
        operations.push({ type: 'record_relation.create', entity: { id: randomUUID(), relationTypeId: edge.relationTypeId, sourceRecordId, targetRecordId, values: {} } });
      }
    }

    await this.graphCommands.apply(userId, modelId, { expectedRevision: graph.revision, operations } as never);

    const updatedGraph = await this.graphCommands.getGraph(userId, modelId);
    await this.ageGraph.dropGraph(modelId);
    const { vertexCount, edgeCount, failedVertexCount, failedEdgeCount } = await this.ageGraph.buildGraph(updatedGraph, modelId);

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
    // Filter by recordMap so stale AGE vertices from previous runs (same model_id, old UUIDs) are ignored.
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
