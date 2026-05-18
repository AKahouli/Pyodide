import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../logger';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { DocumentStatus } from '../../workspace/schemas/workspace-document.schema';
import { IGrpcAgent, IGrpcWorkspaceContext } from '../../agent/interfaces/agent.interface';
import { Workspace, WorkspaceDocument } from '../../workspace/schemas/workspace.schema';
import {
  WorkspaceSetting,
  WorkspaceSettingDocument,
} from '../../workspace/schemas/workspace-setting.schema';

@Injectable()
export class PlaybookContextService {
  constructor(
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(WorkspaceSetting.name)
    private readonly workspaceSettingModel: Model<WorkspaceSettingDocument>,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookContextService');
  }

  private mapWorkspaceDocument(doc: any, workspaceId: string): any {
    return {
      _id: doc.id,
      filename: doc.originalName,
      filepath: doc.path,
      in_memory: false,
      language: doc.detected_language || 'fr',
      indexing_token: doc.chunk_size || 1200,
      workspace_id: workspaceId,
      createdAt: doc.createdAt,
    };
  }

  /**
   * Resolve a document-type input file to workspace document ids that ADK can
   * hydrate from workspace_context. Prefer exact persisted ids before fallbacks.
   */
  private async resolveWorkspaceDocumentIdsForInputFile(
    file: { type: string; id: string; name: string; workspaceId?: string; metadata?: any },
  ): Promise<string[]> {
    const normalizeFilename = (value: string): string =>
      String(value || '')
        .trim()
        .replace(/_/g, ' ')
        .replace(/[\r\n\f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();

    const basename = (value: string): string => {
      const normalized = String(value || '').trim().replace(/\\/g, '/');
      return normalized.includes('/') ? normalized.split('/').pop() || '' : normalized;
    };

    if (file.type !== 'document') {
      return [];
    }

    const explicitWorkspaceId =
      file.workspaceId || file.metadata?.workspaceId || file.metadata?.workspace_id;
    const candidateIds = new Set<string>(
      [
        file.id,
        file.metadata?.documentId,
        file.metadata?.document_id,
        file.metadata?.externalId,
        file.metadata?.external_id,
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    );

    const workspaceIds = new Set<string>();
    if (explicitWorkspaceId) {
      workspaceIds.add(String(explicitWorkspaceId));
    }

    const explicitPath = String(file.metadata?.path || file.metadata?.filepath || '').trim();
    const explicitName = String(
      file.metadata?.originalName || file.metadata?.filename || file.name || '',
    ).trim();
    const normalizedExplicitName = normalizeFilename(explicitName);
    const explicitPathBasename = normalizeFilename(basename(explicitPath));

    for (const workspaceId of workspaceIds) {
      const result = await this.workspaceDocumentService.findAllByWorkspace(workspaceId, {
        limit: 1000,
        status: DocumentStatus.COMPLETED,
      });

      const findMatches = (matcher: (doc: any) => boolean): any[] =>
        result.documents.filter((doc: any) => matcher(doc));

      const matchesById = findMatches((doc: any) => {
        const docIds = [
          doc.id,
          doc._id,
          doc.externalId,
          doc.external_id,
          doc.documentId,
          doc.document_id,
        ]
          .map((value) => String(value || '').trim())
          .filter(Boolean);
        return docIds.some((value) => candidateIds.has(value));
      });

      const matchesByExactPath =
        matchesById.length > 0
          ? []
          : findMatches(
              (doc: any) => Boolean(explicitPath) && String(doc.path || '').trim() === explicitPath,
            );

      const matchesByExactName =
        matchesById.length > 0 || matchesByExactPath.length > 0
          ? []
          : findMatches(
              (doc: any) =>
                Boolean(explicitName) && String(doc.originalName || '').trim() === explicitName,
            );

      const matchesByBasename =
        matchesById.length > 0 ||
        matchesByExactPath.length > 0 ||
        matchesByExactName.length > 0
          ? []
          : findMatches((doc: any) => {
              const docPathBasename = normalizeFilename(
                basename(String(doc.path || '').trim()),
              );
              return Boolean(explicitPathBasename) && docPathBasename === explicitPathBasename;
            });

      const matchesByNormalizedName =
        matchesById.length > 0 ||
        matchesByExactPath.length > 0 ||
        matchesByExactName.length > 0 ||
        matchesByBasename.length > 0
          ? []
          : findMatches((doc: any) => {
              const normalizedDocName = normalizeFilename(String(doc.originalName || '').trim());
              return Boolean(normalizedExplicitName) && normalizedDocName === normalizedExplicitName;
            });

      const matches =
        matchesById.length > 0
          ? matchesById
          : matchesByExactPath.length > 0
            ? matchesByExactPath
            : matchesByExactName.length > 0
              ? matchesByExactName
              : matchesByBasename.length > 0
                ? matchesByBasename
                : matchesByNormalizedName;

      if (matches.length > 0) {
        this.logger.debug('Resolved playbook input file to workspace documents', {
          workspaceId,
          inputFileId: file.id,
          inputFileName: file.name,
          inputFileMetadata: file.metadata || {},
          matchedDocumentIds: matches.map((doc: any) => doc.id || doc._id || ''),
          matchedDocuments: matches.map((doc: any) => ({
            id: doc.id || doc._id || '',
            originalName: doc.originalName || '',
            path: doc.path || '',
            externalId: doc.externalId || doc.external_id || '',
          })),
        });
        return matches
          .map((doc: any) => String(doc.id || doc._id || '').trim())
          .filter(Boolean);
      }

      this.logger.debug('No workspace document match for playbook input file', {
        workspaceId,
        inputFileId: file.id,
        inputFileName: file.name,
        inputFileMetadata: file.metadata || {},
        candidateIds: Array.from(candidateIds),
        sampledWorkspaceDocuments: result.documents.slice(0, 10).map((doc: any) => ({
          id: doc.id || doc._id || '',
          originalName: doc.originalName || '',
          path: doc.path || '',
          externalId: doc.externalId || doc.external_id || '',
        })),
      });
    }

    return Array.from(candidateIds);
  }

  /**
   * Build workspace contexts from a playbook's linked workspace IDs.
   */
  async buildWorkspaceContexts(
    workspaceIds: string[],
  ): Promise<Array<{ workspace_id: string; chunks?: number; hybrid_search?: boolean; instruction?: string; tag?: string; workspace_documents: any[] }>> {
    if (!workspaceIds || workspaceIds.length === 0) {
      return [];
    }

    const contexts: Array<{ workspace_id: string; chunks?: number; hybrid_search?: boolean; instruction?: string; tag?: string; workspace_documents: any[] }> = [];

    for (const workspaceId of workspaceIds) {
      try {
        const workspace = await this.workspaceModel.findById(workspaceId).lean().exec();
        let settings: WorkspaceSettingDocument | null = null;
        if (workspace?.settings) {
          settings = await this.workspaceSettingModel.findById(workspace.settings).lean().exec() as WorkspaceSettingDocument | null;
        }

        const result = await this.workspaceDocumentService.findAllByWorkspace(workspaceId, {
          limit: 1000,
          status: DocumentStatus.COMPLETED,
        });

        contexts.push({
          workspace_id: workspaceId,
          chunks: settings?.chunks,
          hybrid_search: settings?.hybridSearch,
          instruction: settings?.instruction,
          tag: settings?.tag,
          workspace_documents: result.documents.map((doc: any) => this.mapWorkspaceDocument(doc, workspaceId)),
        });
      } catch (error) {
        this.logger.warn('Failed to build workspace context for playbook workspace', {
          workspaceId,
          error: (error as Error).message,
        });
      }
    }

    this.logger.log('Workspace contexts built for playbook', {
      requestedWorkspaceCount: workspaceIds.length,
      workspaceCount: contexts.length,
      totalDocuments: contexts.reduce((sum, ctx) => sum + ctx.workspace_documents.length, 0),
    });

    return contexts;
  }

  /**
   * Build workspace contexts from task-level input files.
   * When a task has specific input files (dragged & dropped), use those
   * instead of the playbook-level workspace context.
   */
  async buildWorkspaceContextFromInputFiles(
    inputFiles: Array<{ type: string; id: string; name: string; workspaceId?: string; metadata?: any }>,
  ): Promise<Array<{ workspace_id: string; chunks?: number; hybrid_search?: boolean; instruction?: string; tag?: string; workspace_documents: any[] }>> {
    if (!inputFiles || inputFiles.length === 0) {
      return [];
    }

    try {
      const workspaceIdSet = new Set<string>();
      const documentIds: string[] = [];

      for (const file of inputFiles) {
        if (file.type === 'workspace') {
          workspaceIdSet.add(file.id);
        } else if (file.type === 'document') {
          const resolvedDocIds = await this.resolveWorkspaceDocumentIdsForInputFile(file);
          documentIds.push(...resolvedDocIds);
          if (file.workspaceId) {
            workspaceIdSet.add(file.workspaceId);
          }
        }
      }

      const contexts: Array<{ workspace_id: string; chunks?: number; hybrid_search?: boolean; instruction?: string; tag?: string; workspace_documents: any[] }> = [];

      for (const workspaceId of workspaceIdSet) {
        const workspace = await this.workspaceModel.findById(workspaceId).lean().exec();
        let settings: WorkspaceSettingDocument | null = null;
        if (workspace?.settings) {
          settings = await this.workspaceSettingModel.findById(workspace.settings).lean().exec() as WorkspaceSettingDocument | null;
        }

        const result = await this.workspaceDocumentService.findAllByWorkspace(workspaceId, {
          limit: 1000,
          status: DocumentStatus.COMPLETED,
        });

        const selectedDocuments = result.documents.filter((doc: any) => {
          if (documentIds.includes(doc.id)) {
            return true;
          }
          const hasWorkspaceInput = inputFiles.some(
            (f) => f.type === 'workspace' && f.id === workspaceId,
          );
          return hasWorkspaceInput;
        });

        if (selectedDocuments.length > 0) {
          contexts.push({
            workspace_id: workspaceId,
            chunks: settings?.chunks,
            hybrid_search: settings?.hybridSearch,
            instruction: settings?.instruction,
            tag: settings?.tag,
            workspace_documents: selectedDocuments.map((doc: any) => this.mapWorkspaceDocument(doc, workspaceId)),
          });
        }
      }

      this.logger.log('Workspace contexts built from task input files', {
        workspaceCount: contexts.length,
        totalDocuments: contexts.reduce((sum, ctx) => sum + ctx.workspace_documents.length, 0),
        inputFilesCount: inputFiles.length,
      });

      return contexts;
    } catch (error) {
      this.logger.warn('Failed to build workspace contexts from task input files', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Resolve workspace documents for each agent's brain_context.
   * Mutates agents in-place, filling workspace_documents arrays.
   */
  async resolveAgentBrainContexts(agents: IGrpcAgent[]): Promise<void> {
    const allWsIds = [...new Set(agents.flatMap((a) => a.brain_context.map((c) => c.workspace_id)))];
    if (allWsIds.length === 0) return;

    const contextMap = new Map<string, IGrpcWorkspaceContext>();
    const results = await Promise.allSettled(
      allWsIds.map(async (wsId) => {
        const result = await this.workspaceDocumentService.findAllByWorkspace(wsId, {
          limit: 1000,
          status: DocumentStatus.COMPLETED,
        });
        const workspace = await this.workspaceModel.findById(wsId).lean().exec();
        let settings: WorkspaceSettingDocument | null = null;
        if (workspace?.settings) {
          settings = await this.workspaceSettingModel.findById(workspace.settings).lean().exec() as WorkspaceSettingDocument | null;
        }
        contextMap.set(wsId, {
          workspace_id: wsId,
          chunks: settings?.chunks,
          hybrid_search: settings?.hybridSearch,
          instruction: settings?.instruction,
          tag: settings?.tag,
          workspace_documents: result.documents.map((doc: any) => this.mapWorkspaceDocument(doc, wsId)),
        });
      }),
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        this.logger.warn('Failed to resolve brain context workspace', {
          workspaceId: allWsIds[i],
          error: (results[i] as PromiseRejectedResult).reason?.message,
        });
      }
    }

    for (const agent of agents) {
      agent.brain_context = agent.brain_context
        .map((c) => contextMap.get(c.workspace_id))
        .filter(Boolean) as IGrpcWorkspaceContext[];
    }

    this.logger.log('Agent brain contexts resolved', {
      agentCount: agents.length,
      workspaceCount: contextMap.size,
      totalDocuments: [...contextMap.values()].reduce((sum, ctx) => sum + ctx.workspace_documents.length, 0),
    });
  }

  /**
   * Extract document IDs from task inputFiles.
   * For document-type: returns the document ID directly.
   * For workspace-type: fetches all document IDs from that workspace.
   */
  async extractDocumentIdsFromInputFiles(
    inputFiles: Array<{ type: string; id: string; name: string; workspaceId?: string; metadata?: any }>,
  ): Promise<string[]> {
    if (!inputFiles || inputFiles.length === 0) {
      return [];
    }

    const documentIds: string[] = [];

    try {
      for (const file of inputFiles) {
        if (file.type === 'document') {
          const resolvedDocIds = await this.resolveWorkspaceDocumentIdsForInputFile(file);
          documentIds.push(...resolvedDocIds);
        } else if (file.type === 'workspace') {
          const result = await this.workspaceDocumentService.findAllByWorkspace(file.id, {
            limit: 1000,
            status: DocumentStatus.COMPLETED,
          });
          const workspaceDocIds = result.documents.map((doc: any) => doc.id);
          documentIds.push(...workspaceDocIds);
        }
      }

      this.logger.log('Extracted document IDs from input files', {
        inputFilesCount: inputFiles.length,
        documentIdsCount: documentIds.length,
      });

      return documentIds;
    } catch (error) {
      this.logger.warn('Failed to extract document IDs from input files', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Extract document IDs from task inputFiles, grouped by port.
   * Files without a portId are grouped under the 'default' port.
   * For document-type: returns the document ID directly.
   * For workspace-type: fetches all document IDs from that workspace.
   */
  async extractDocumentIdsByPort(
    inputFiles: Array<{ type: string; id: string; name: string; workspaceId?: string; portId?: string; metadata?: any }>,
  ): Promise<Array<{ port_id: string; document_ids: string[] }>> {
    if (!inputFiles || inputFiles.length === 0) {
      return [];
    }

    const portToDocIds = new Map<string, Set<string>>();

    try {
      for (const file of inputFiles) {
        const portId = file.portId || 'default';
        if (!portToDocIds.has(portId)) {
          portToDocIds.set(portId, new Set<string>());
        }

        if (file.type === 'document') {
          const resolvedDocIds = await this.resolveWorkspaceDocumentIdsForInputFile(file);
          for (const docId of resolvedDocIds) {
            portToDocIds.get(portId)!.add(docId);
          }
        } else if (file.type === 'workspace') {
          const result = await this.workspaceDocumentService.findAllByWorkspace(file.id, {
            limit: 1000,
            status: DocumentStatus.COMPLETED,
          });
          const workspaceDocIds = result.documents.map((doc: any) => doc.id);
          for (const docId of workspaceDocIds) {
            portToDocIds.get(portId)!.add(docId);
          }
        }
      }

      const result = Array.from(portToDocIds.entries()).map(([port_id, docIds]) => ({
        port_id,
        document_ids: Array.from(docIds),
      }));

      this.logger.log('Extracted document IDs by port from input files', {
        inputFilesCount: inputFiles.length,
        portCount: result.length,
        ports: result.map(p => ({ portId: p.port_id, docCount: p.document_ids.length })),
      });

      return result;
    } catch (error) {
      this.logger.warn('Failed to extract document IDs by port from input files', {
        error: (error as Error).message,
      });
      return [];
    }
  }
}
