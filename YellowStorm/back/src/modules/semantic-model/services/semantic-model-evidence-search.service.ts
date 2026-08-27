import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import semanticModelConfig from '@config/semantic-model.config';
import { AGENT_TASK_EXECUTOR } from '@common/tokens/agent-task-execution.token';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelEvidenceSearchFailedUnit, SemanticModelEvidenceSearchResponse, SemanticModelEvidenceSearchTask } from '../domain/semantic-model-evidence-search.types';
import { SemanticGraph } from '../domain/semantic-model.types';
import { SelectedCorpusBinding } from '../domain/selected-corpus-manifest.types';
import { SemanticModelCorpusPreparationService } from './semantic-model-corpus-preparation.service';
import { SemanticGraphCommandService } from './semantic-graph-command.service';
import { SemanticModelService } from './semantic-model.service';

interface AgentTaskExecutor {
  runSingleAgentTask(input: {
    userId: string;
    agentId: string;
    query: string;
    attachedFiles: [];
    workspaceContext: Array<{ workspace_id: string; workspace_name: string }>;
    correlationId: string;
    conversationId: string;
    timeoutMs?: number;
    usageEndpoint: string;
  }): Promise<{
    text: string;
    citations: Array<{
      source: string;
      fileName: string;
      page?: string;
      pageContent?: string;
      workspaceId?: string;
      reference?: string;
      highlightText?: string;
    }>;
    toolResults: Array<{ name: string; status: 'completed' | 'failed'; result: unknown }>;
  }>;
}

@Injectable()
export class SemanticModelEvidenceSearchService {
  private readonly logger = new Logger(SemanticModelEvidenceSearchService.name);

  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
    private readonly models: SemanticModelService,
    private readonly corpusPreparation: SemanticModelCorpusPreparationService,
    private readonly graphCommands: SemanticGraphCommandService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async search(userId: string, modelId: string): Promise<SemanticModelEvidenceSearchResponse> {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const searchAgentId = this.config.searchAgentId;
    if (!searchAgentId) {
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'SEMANTIC_MODEL_SEARCH_AGENT_ID is not configured',
      );
    }

    const manifest = await this.corpusPreparation.prepare(userId, modelId);
    const graph = await this.graphCommands.getGraph(userId, modelId) as SemanticGraph;
    const bindings = manifest.bindings.filter((binding) => binding.documents.length > 0);
    const agentTasks = this.moduleRef.get<AgentTaskExecutor>(AGENT_TASK_EXECUTOR, { strict: false });
    const searchRunId = randomUUID();
    const searchUnits = bindings.flatMap((binding) =>
      binding.documents.map((document) => ({ binding, document })),
    );
    const failedUnits: SemanticModelEvidenceSearchFailedUnit[] = [];
    const runUnit = async ({ binding, document }: { binding: typeof bindings[number]; document: typeof binding.documents[number] }): Promise<SemanticModelEvidenceSearchTask | null> => {
      // ADK persists conversationId in a varchar(128) column, so we cannot
      // fit modelId + bindingId + documentId + runId (~147 chars). Use a
      // fresh UUID for isolation and rely on correlationId + logs for tracing.
      const conversationId = `sm-e:${randomUUID()}`;
      try {
        const result = await agentTasks.runSingleAgentTask({
          userId,
          agentId: searchAgentId,
          query: this.buildSearchTask(binding, graph, document),
          attachedFiles: [],
          workspaceContext: [{
            workspace_id: binding.workspaceId,
            workspace_name: binding.workspaceId,
          }],
          correlationId: `semantic-model-evidence:${modelId}:${binding.bindingId}:${document.sourceDocumentId}:${searchRunId}`,
          conversationId,
          timeoutMs: this.config.evidenceSearchTimeoutMs,
          usageEndpoint: 'semantic-model-evidence-search',
        });
        // search_native results don't go through citation_sources registration so
        // result.citations is empty. Extract passages directly from toolResults.
        const toolEvidence = result.toolResults
          .filter((tr) => tr.status === 'completed' && String(tr.name).includes('search_native'))
          .flatMap((tr) => {
            const payload = tr.result as Record<string, unknown> | null;
            const sections: unknown[] = Array.isArray(payload?.result) ? (payload!.result as unknown[])
              : Array.isArray(payload) ? (payload as unknown[]) : [];
            return sections.flatMap((section) => {
              if (!section || typeof section !== 'object') return [];
              const s = section as Record<string, unknown>;
              const quote = String(s['content'] || '').trim();
              if (!quote) return [];
              return [{
                source: String(s['file_name'] || ''),
                fileName: String(s['file_name'] || document.originalName),
                page: s['page_range'] ? String(s['page_range']) : undefined,
                quote,
                workspaceId: String(s['workspace_id'] || binding.workspaceId),
                reference: s['section_id'] != null ? String(s['section_id']) : undefined,
              }];
            });
          });
        const citationEvidence = result.citations.map((citation) => ({
          source: citation.source,
          fileName: citation.fileName,
          page: citation.page,
          quote: citation.highlightText || citation.pageContent,
          workspaceId: citation.workspaceId,
          reference: citation.reference,
        }));
        return {
          bindingId: binding.bindingId,
          target: binding.target,
          workspaceId: binding.workspaceId,
          sourceDocumentId: document.sourceDocumentId,
          fileName: document.originalName,
          text: result.text,
          evidence: this.uniqueEvidence([...toolEvidence, ...citationEvidence]),
          toolResults: result.toolResults,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
        this.logger.warn('Evidence search unit failed — skipping, continuing with partial results', {
          modelId,
          bindingId: binding.bindingId,
          sourceDocumentId: document.sourceDocumentId,
          fileName: document.originalName,
          error: errorMessage,
        });
        failedUnits.push({ bindingId: binding.bindingId, sourceDocumentId: document.sourceDocumentId, fileName: document.originalName, error: errorMessage });
        return null;
      }
    };
    const rawResults = await this.runWithConcurrency(searchUnits, this.config.evidenceSearchConcurrency, runUnit);
    const tasks = rawResults.filter((t): t is SemanticModelEvidenceSearchTask => t !== null);

    return {
      modelId,
      searchedAt: new Date().toISOString(),
      tasks,
      failedUnits,
      summary: {
        searchedBindingCount: tasks.length,
        candidateDocumentCount: bindings.reduce((count, binding) => count + binding.documents.length, 0),
        failedUnitCount: failedUnits.length,
      },
    };
  }

  private buildSearchTask(
    binding: SelectedCorpusBinding,
    graph: SemanticGraph,
    document: SelectedCorpusBinding['documents'][number],
  ): string {
    const ontologySearchScope = this.describeOntologySearchScope(binding, graph);
    return [
      'Collect evidence for the Semantic Model using ONLY the search_native connector tool. Do not use any other retrieval tool (no get_document_strategy, no read_content, no read_blocks, no search, no web search, no Deep Search).',
      `Workspace ID: ${binding.workspaceId}`,
      `Document file name: ${document.originalName} (sourceDocumentId: ${document.sourceDocumentId})`,
      `Ontology target: ${binding.target.kind} "${binding.target.label}".`,
      `Ontology search scope: ${JSON.stringify(ontologySearchScope)}.`,
      'For EACH attribute declared in the ontology search scope, call search_native exactly once with: workspace_id, file_name, and a query that is ALWAYS scoped to the concept — combine the concept label with the attribute label and description. Example: for concept "Skill" and attribute "name", the query must be "Skill: name of the skill, competency or technology" — NEVER just "name". Scoping the query to the concept prevents the tool from returning passages about unrelated entity types that happen to share the same field name.',
      'Additionally call search_native once with a query asking for the main subject or identifier of this document in the context of the concept (e.g. for an Employee concept: "Employee: full name of the employee") so the extracted instance can be labeled.',
      'After retrieval, register the passages you rely on as citations via locate_answer_citations.',
      'Report per attribute: a short supporting quote when found, or an explicit not_found marker. Never invent values. Do not create ontology entities, relations, or inferred facts in this task.',
    ].join('\n');
  }

  private uniqueEvidence(evidence: SemanticModelEvidenceSearchTask['evidence']): SemanticModelEvidenceSearchTask['evidence'] {
    return [...new Map(evidence.map((item) => [
      [item.source, item.fileName, item.page ?? '', item.quote ?? ''].join('|'),
      item,
    ])).values()];
  }

  private async runWithConcurrency<TInput, TOutput>(
    items: TInput[],
    concurrency: number,
    handler: (item: TInput, index: number) => Promise<TOutput>,
  ): Promise<TOutput[]> {
    if (items.length === 0) return [];
    const results = new Array<TOutput>(items.length);
    const limit = Math.min(Math.max(1, concurrency), items.length);
    let cursor = 0;
    const workers = Array.from({ length: limit }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await handler(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private describeOntologySearchScope(binding: SelectedCorpusBinding, graph: SemanticGraph): Record<string, unknown> {
    const attributes = (items: SemanticGraph['nodes'][number]['attributes']) => items.map((attribute) => ({
      key: attribute.key,
      label: attribute.label,
      type: attribute.type,
      description: attribute.description,
      required: attribute.required,
      options: attribute.options,
    }));
    const node = graph.nodes.find((candidate) => candidate.id === binding.target.id);
    if (binding.target.kind === 'node_type' && node) {
      return {
        kind: 'node_type',
        key: node.key,
        label: node.label,
        description: node.description,
        aliases: node.aliases,
        attributes: attributes(node.attributes),
      };
    }

    const relation = graph.relations.find((candidate) => candidate.id === binding.target.id);
    if (binding.target.kind === 'relation_type' && relation) {
      const source = graph.nodes.find((candidate) => candidate.id === relation.sourceNodeTypeId);
      const target = graph.nodes.find((candidate) => candidate.id === relation.targetNodeTypeId);
      return {
        kind: 'relation_type',
        key: relation.key,
        label: relation.label,
        inverseLabel: relation.inverseLabel,
        description: relation.description,
        cardinality: relation.cardinality,
        source: source && { key: source.key, label: source.label, attributes: attributes(source.attributes) },
        target: target && { key: target.key, label: target.label, attributes: attributes(target.attributes) },
        attributes: attributes(relation.attributes),
      };
    }

    const record = graph.records.find((candidate) => candidate.id === binding.target.id);
    if (binding.target.kind === 'record' && record) {
      const recordType = graph.nodes.find((candidate) => candidate.id === record.nodeTypeId);
      return {
        kind: 'record',
        label: record.label,
        nodeType: recordType && { key: recordType.key, label: recordType.label, attributes: attributes(recordType.attributes) },
      };
    }

    return {
      kind: 'model',
      nodeTypes: graph.nodes.map((candidate) => ({
        key: candidate.key,
        label: candidate.label,
        description: candidate.description,
        aliases: candidate.aliases,
        attributes: attributes(candidate.attributes),
      })),
      relationTypes: graph.relations.map((candidate) => ({
        key: candidate.key,
        label: candidate.label,
        description: candidate.description,
        sourceNodeTypeId: candidate.sourceNodeTypeId,
        targetNodeTypeId: candidate.targetNodeTypeId,
        attributes: attributes(candidate.attributes),
      })),
    };
  }
}
