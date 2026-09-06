import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@modules/exceptions';
import { DocumentResponse } from '@modules/workspace/interfaces/workspace-document.interface';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import {
  SelectedCorpusBinding,
  SelectedCorpusDocument,
  SelectedCorpusExclusion,
  SelectedCorpusManifest,
} from '../domain/selected-corpus-manifest.types';
import { SemanticGraphCommandService } from './semantic-graph-command.service';
import { SemanticKnowledgeBinding, SemanticKnowledgeBindingService } from './semantic-knowledge-binding.service';
import { SemanticModelService } from './semantic-model.service';

@Injectable()
export class SemanticModelCorpusPreparationService {
  constructor(
    private readonly models: SemanticModelService,
    private readonly graph: SemanticGraphCommandService,
    private readonly bindings: SemanticKnowledgeBindingService,
    private readonly documents: WorkspaceDocumentService,
  ) {}

  async prepare(userId: string, modelId: string): Promise<SelectedCorpusManifest> {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const [graph, bindings] = await Promise.all([
      this.graph.getGraph(userId, modelId, 'structure'),
      this.bindings.list(userId, modelId),
    ]);
    const nodeLabels = new Map(graph.nodes.map((node) => [node.id, node.label]));
    const relationLabels = new Map(graph.relations.map((relation) => [relation.id, relation.label]));
    const activeBindings = bindings.filter((binding) => binding.enabled);
    const workspaceDocuments = new Map<string, DocumentResponse[]>();
    const excluded: SelectedCorpusExclusion[] = [];

    const preparedBindings = await Promise.all(activeBindings.map(async (binding) => {
      if (binding.availability !== 'available') {
        excluded.push({
          bindingId: binding.id,
          workspaceId: binding.workspaceId,
          documentId: binding.documentId,
          reason: 'binding_unavailable',
        });
        return this.toPreparedBinding(binding, this.resolveTargetLabel(binding, model.name, nodeLabels, relationLabels), []);
      }

      const documents = binding.resourceKind === 'document'
        ? await this.resolveExplicitDocument(binding, excluded)
        : await this.resolveWorkspaceDocuments(binding, workspaceDocuments, excluded);
      return this.toPreparedBinding(binding, this.resolveTargetLabel(binding, model.name, nodeLabels, relationLabels), documents);
    }));

    return {
      modelId,
      preparedAt: new Date().toISOString(),
      bindings: preparedBindings,
      excluded,
      summary: {
        bindingCount: preparedBindings.length,
        documentCount: preparedBindings.reduce((total, binding) => total + binding.documents.length, 0),
        excludedCount: excluded.length,
      },
    };
  }

  private async resolveExplicitDocument(
    binding: SemanticKnowledgeBinding,
    excluded: SelectedCorpusExclusion[],
  ): Promise<SelectedCorpusDocument[]> {
    if (!binding.documentId) return [];
    try {
      const document = await this.documents.findById(binding.workspaceId, binding.documentId);
      return this.toSelectedDocument(binding, document, excluded);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      excluded.push({
        bindingId: binding.id,
        workspaceId: binding.workspaceId,
        documentId: binding.documentId,
        reason: 'document_not_found',
      });
      return [];
    }
  }

  private async resolveWorkspaceDocuments(
    binding: SemanticKnowledgeBinding,
    cache: Map<string, DocumentResponse[]>,
    excluded: SelectedCorpusExclusion[],
  ): Promise<SelectedCorpusDocument[]> {
    let documents = cache.get(binding.workspaceId);
    if (!documents) {
      documents = await this.listWorkspaceDocuments(binding.workspaceId);
      cache.set(binding.workspaceId, documents);
    }
    return documents.flatMap((document) => this.toSelectedDocument(binding, document, excluded));
  }

  private async listWorkspaceDocuments(workspaceId: string): Promise<DocumentResponse[]> {
    const documents: DocumentResponse[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const result = await this.documents.findAllSorted(workspaceId, {
        page,
        limit: 100,
        sortBy: 'originalName',
        sortOrder: 'asc',
      });
      documents.push(...result.documents);
      totalPages = result.pagination.totalPages;
      page += 1;
    }
    return documents;
  }

  private toSelectedDocument(
    binding: Pick<SemanticKnowledgeBinding, 'id' | 'workspaceId'>,
    document: DocumentResponse,
    excluded: SelectedCorpusExclusion[],
  ): SelectedCorpusDocument[] {
    if (document.isFolder) {
      excluded.push({ bindingId: binding.id, workspaceId: binding.workspaceId, documentId: document.id, reason: 'folder' });
      return [];
    }
    return [{
      sourceDocumentId: document.id,
      workspaceId: document.workspaceId,
      originalName: document.originalName,
      mimeType: document.mimeType,
      indexingStatus: document.indexingStatus,
      lastIndexedAt: document.lastIndexedAt,
    }];
  }

  private toPreparedBinding(
    binding: SemanticKnowledgeBinding,
    label: string,
    documents: SelectedCorpusDocument[],
  ): SelectedCorpusBinding {
    return {
      bindingId: binding.id,
      target: { kind: binding.targetKind, id: binding.targetId, label },
      resourceKind: binding.resourceKind,
      workspaceId: binding.workspaceId,
      documentId: binding.documentId,
      retrievalMode: binding.retrievalMode,
      priority: binding.priority,
      documents,
    };
  }

  private resolveTargetLabel(
    binding: SemanticKnowledgeBinding,
    modelName: string,
    nodeLabels: Map<string, string>,
    relationLabels: Map<string, string>,
  ): string {
    if (binding.targetKind === 'model') return modelName;
    if (binding.targetKind === 'node_type') return nodeLabels.get(binding.targetId ?? '') ?? 'Unknown concept';
    if (binding.targetKind === 'relation_type') return relationLabels.get(binding.targetId ?? '') ?? 'Unknown relation';
    return 'Business record';
  }
}
