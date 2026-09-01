import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import {
  SemanticModelEvidenceSearchFailedUnit,
  SemanticModelEvidenceSearchResponse,
  SemanticModelEvidenceSearchTask,
} from '../domain/semantic-model-evidence-search.types';
import { SemanticGraph } from '../domain/semantic-model.types';
import { SelectedCorpusBinding } from '../domain/selected-corpus-manifest.types';
import { SemanticGraphCommandService } from './semantic-graph-command.service';
import { SemanticModelCorpusPreparationService } from './semantic-model-corpus-preparation.service';
import {
  SemanticModelNativeSearchClient,
  SemanticModelNativeSearchFatalError,
  SemanticModelNativeSearchSection,
} from './semantic-model-native-search-client.service';
import { SemanticModelService } from './semantic-model.service';

@Injectable()
export class SemanticModelEvidenceSearchService {
  private readonly logger = new Logger(SemanticModelEvidenceSearchService.name);

  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
    private readonly models: SemanticModelService,
    private readonly corpusPreparation: SemanticModelCorpusPreparationService,
    private readonly graphCommands: SemanticGraphCommandService,
    private readonly nativeSearch: SemanticModelNativeSearchClient,
  ) {}

  async search(userId: string, modelId: string): Promise<SemanticModelEvidenceSearchResponse> {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const manifest = await this.corpusPreparation.prepare(userId, modelId);
    const graph = await this.graphCommands.getGraph(userId, modelId) as SemanticGraph;
    const bindings = manifest.bindings.filter((binding) => binding.documents.length > 0);
    const searchUnits = bindings.flatMap((binding) =>
      binding.documents.map((document) => ({ binding, document })),
    );
    const failedUnits: SemanticModelEvidenceSearchFailedUnit[] = [];
    const jobs = searchUnits.flatMap(({ binding, document }, unitIndex) =>
      this.buildSearchQueries(binding, graph).map((query, queryIndex) => ({
        unitIndex,
        queryIndex,
        binding,
        document,
        query,
      })),
    );

    const jobResults = await this.runWithConcurrency(
      jobs,
      this.config.evidenceSearchConcurrency,
      async (job) => {
        try {
          const sections = await this.nativeSearch.search({
            query: job.query,
            workspace_id: job.binding.workspaceId,
            file_name: job.document.originalName,
          });
          return { ...job, sections, error: null as string | null };
        } catch (error) {
          if (error instanceof SemanticModelNativeSearchFatalError) throw error;
          const message = error instanceof Error
            ? error.message.slice(0, 300)
            : String(error).slice(0, 300);
          return {
            ...job,
            sections: [] as SemanticModelNativeSearchSection[],
            error: message,
          };
        }
      },
    );

    const resultsByUnit = new Map<number, typeof jobResults>();
    for (const result of jobResults) {
      const unitResults = resultsByUnit.get(result.unitIndex) ?? [];
      unitResults.push(result);
      resultsByUnit.set(result.unitIndex, unitResults);
    }

    const tasks: SemanticModelEvidenceSearchTask[] = [];
    for (const [unitIndex, unit] of searchUnits.entries()) {
      const unitResults = (resultsByUnit.get(unitIndex) ?? [])
        .sort((left, right) => left.queryIndex - right.queryIndex);
      const successful = unitResults.filter((result) => !result.error);
      if (unitResults.length === 0 || successful.length === 0) {
        const errorMessage = unitResults
          .map((result) => result.error)
          .filter(Boolean)
          .join('; ') || 'No search queries were generated';
        this.logger.warn('Evidence search unit failed — skipping, continuing with partial results', {
          modelId,
          bindingId: unit.binding.bindingId,
          sourceDocumentId: unit.document.sourceDocumentId,
          fileName: unit.document.originalName,
          error: errorMessage,
        });
        failedUnits.push({
          bindingId: unit.binding.bindingId,
          sourceDocumentId: unit.document.sourceDocumentId,
          fileName: unit.document.originalName,
          error: errorMessage.slice(0, 300),
        });
        continue;
      }

      const evidence = successful.flatMap((result) =>
        this.toEvidence(result.sections, unit.binding.workspaceId, unit.document.originalName),
      );
      tasks.push({
        bindingId: unit.binding.bindingId,
        target: unit.binding.target,
        workspaceId: unit.binding.workspaceId,
        sourceDocumentId: unit.document.sourceDocumentId,
        fileName: unit.document.originalName,
        text: `${successful.length}/${unitResults.length} native search queries completed`,
        evidence: this.uniqueEvidence(evidence),
        toolResults: unitResults.map((result) => ({
          name: 'search_native',
          status: result.error ? 'failed' : 'completed',
          result: result.error
            ? { query: result.query, error: result.error }
            : { query: result.query, result: result.sections },
        })),
      });
    }

    return {
      modelId,
      searchedAt: new Date().toISOString(),
      tasks,
      failedUnits,
      summary: {
        searchedBindingCount: tasks.length,
        candidateDocumentCount: bindings.reduce(
          (count, binding) => count + binding.documents.length,
          0,
        ),
        failedUnitCount: failedUnits.length,
      },
    };
  }

  private buildSearchQueries(binding: SelectedCorpusBinding, graph: SemanticGraph): string[] {
    const scope = this.describeOntologySearchScope(binding, graph);
    const concepts = this.searchConcepts(scope, binding.target.label);
    return [...new Set(concepts.flatMap(({ label, attributes }) => [
      ...attributes.map((attribute) => {
        const detail = [attribute['label'] || attribute['key'], attribute['description']]
          .filter((value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
          )
          .join(': ');
        return `${label}: ${detail}`;
      }),
      `${label}: main subject, proper name, or identifier of the ${label}`,
    ]))];
  }

  private searchConcepts(
    scope: Record<string, unknown>,
    fallbackLabel: string,
  ): Array<{ label: string; attributes: Array<Record<string, unknown>> }> {
    const result: Array<{ label: string; attributes: Array<Record<string, unknown>> }> = [];
    const add = (candidate: unknown, fallback: string) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
      const value = candidate as Record<string, unknown>;
      const label = String(value['label'] || value['key'] || fallback).trim();
      if (!label) return;
      const attributes = Array.isArray(value['attributes'])
        ? value['attributes'].filter((item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
        )
        : [];
      result.push({ label, attributes });
    };

    if (scope['kind'] === 'model') {
      for (const nodeType of Array.isArray(scope['nodeTypes']) ? scope['nodeTypes'] : []) {
        add(nodeType, fallbackLabel);
      }
    } else if (scope['kind'] === 'relation_type') {
      add(scope['source'], `${fallbackLabel} source`);
      add(scope['target'], `${fallbackLabel} target`);
      add(scope, fallbackLabel);
    } else if (scope['kind'] === 'record') {
      add(scope['nodeType'], fallbackLabel);
    } else {
      add(scope, fallbackLabel);
    }
    return result;
  }

  private toEvidence(
    sections: SemanticModelNativeSearchSection[],
    workspaceId: string,
    fileName: string,
  ): SemanticModelEvidenceSearchTask['evidence'] {
    return sections.flatMap((section) => {
      const quote = String(section.content || '').trim();
      if (!quote) return [];
      return [{
        source: String(section.file_name || fileName),
        fileName: String(section.file_name || fileName),
        page: section.page_range ? String(section.page_range) : undefined,
        quote,
        workspaceId: String(section.workspace_id || workspaceId),
        reference: section.section_id != null ? String(section.section_id) : undefined,
      }];
    });
  }

  private uniqueEvidence(
    evidence: SemanticModelEvidenceSearchTask['evidence'],
  ): SemanticModelEvidenceSearchTask['evidence'] {
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

  private describeOntologySearchScope(
    binding: SelectedCorpusBinding,
    graph: SemanticGraph,
  ): Record<string, unknown> {
    const attributes = (items: SemanticGraph['nodes'][number]['attributes']) =>
      items.map((attribute) => ({
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
        source: source && {
          key: source.key,
          label: source.label,
          attributes: attributes(source.attributes),
        },
        target: target && {
          key: target.key,
          label: target.label,
          attributes: attributes(target.attributes),
        },
        attributes: attributes(relation.attributes),
      };
    }

    const record = graph.records.find((candidate) => candidate.id === binding.target.id);
    if (binding.target.kind === 'record' && record) {
      const recordType = graph.nodes.find((candidate) => candidate.id === record.nodeTypeId);
      return {
        kind: 'record',
        label: record.label,
        nodeType: recordType && {
          key: recordType.key,
          label: recordType.label,
          attributes: attributes(recordType.attributes),
        },
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
    };
  }
}
