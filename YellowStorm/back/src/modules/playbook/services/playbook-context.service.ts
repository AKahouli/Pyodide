import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { DocumentStatus } from '../../workspace/schemas/workspace-document.schema';
import { IGrpcAgent, IGrpcWorkspaceContext } from '../../agent/interfaces/agent.interface';

@Injectable()
export class PlaybookContextService {
  constructor(
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookContextService');
  }

  /**
   * Build workspace contexts from a playbook's linked workspace IDs.
   */
  async buildWorkspaceContexts(
    workspaceIds: string[],
  ): Promise<Array<{ workspace_id: string; workspace_documents: any[] }>> {
    if (!workspaceIds || workspaceIds.length === 0) {
      return [];
    }

    try {
      const contexts: Array<{ workspace_id: string; workspace_documents: any[] }> = [];

      for (const workspaceId of workspaceIds) {
        const result = await this.workspaceDocumentService.findAllByWorkspace(workspaceId, {
          limit: 1000,
          status: DocumentStatus.COMPLETED,
        });

        contexts.push({
          workspace_id: workspaceId,
          workspace_documents: result.documents.map((doc: any) => ({
            _id: doc.id,
            filename: doc.originalName,
            filepath: doc.path,
            in_memory: false,
            language: doc.detected_language || 'fr',
            indexing_token: doc.chunk_size || 1200,
            workspace_id: workspaceId,
            createdAt: doc.createdAt,
          })),
        });
      }

      this.logger.log('Workspace contexts built for playbook', {
        workspaceCount: contexts.length,
        totalDocuments: contexts.reduce((sum, ctx) => sum + ctx.workspace_documents.length, 0),
      });

      return contexts;
    } catch (error) {
      this.logger.warn('Failed to build workspace contexts for playbook', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Build workspace contexts from task-level input files.
   * When a task has specific input files (dragged & dropped), use those
   * instead of the playbook-level workspace context.
   */
  async buildWorkspaceContextFromInputFiles(
    inputFiles: Array<{ type: string; id: string; name: string; workspaceId?: string; metadata?: any }>,
  ): Promise<Array<{ workspace_id: string; workspace_documents: any[] }>> {
    if (!inputFiles || inputFiles.length === 0) {
      return [];
    }

    try {
      const workspaceIdSet = new Set<string>();
      const documentIds: string[] = [];

      // Separate workspace-type and document-type input files
      for (const file of inputFiles) {
        if (file.type === 'workspace') {
          workspaceIdSet.add(file.id);
        } else if (file.type === 'document') {
          // For document type, we need to get the document by ID
          // Store the document ID for fetching
          documentIds.push(file.id);
          // Also track the workspace for documents
          if (file.workspaceId) {
            workspaceIdSet.add(file.workspaceId);
          }
        }
      }

      const contexts: Array<{ workspace_id: string; workspace_documents: any[] }> = [];

      // Build contexts for workspaces (all documents from the workspace)
      for (const workspaceId of workspaceIdSet) {
        const result = await this.workspaceDocumentService.findAllByWorkspace(workspaceId, {
          limit: 1000,
          status: DocumentStatus.COMPLETED,
        });

        // Filter to only include documents that were specifically selected
        const selectedDocuments = result.documents.filter((doc: any) => {
          // Include if this document ID is in the documentIds list
          if (documentIds.includes(doc.id)) {
            return true;
          }
          // Include if this is a workspace-type input (include all documents)
          const hasWorkspaceInput = inputFiles.some(
            (f) => f.type === 'workspace' && f.id === workspaceId,
          );
          return hasWorkspaceInput;
        });

        if (selectedDocuments.length > 0) {
          contexts.push({
            workspace_id: workspaceId,
            workspace_documents: selectedDocuments.map((doc: any) => ({
              _id: doc.id,
              filename: doc.originalName,
              filepath: doc.path,
              in_memory: false,
              language: doc.detected_language || 'fr',
              indexing_token: doc.chunk_size || 1200,
              workspace_id: workspaceId,
              createdAt: doc.createdAt,
            })),
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
        contextMap.set(wsId, {
          workspace_id: wsId,
          workspace_documents: result.documents.map((doc: any) => ({
            _id: doc.id,
            filename: doc.originalName,
            filepath: doc.path,
            in_memory: false,
            language: doc.detected_language || 'fr',
            indexing_token: doc.chunk_size || 1200,
            workspace_id: wsId,
            createdAt: doc.createdAt,
          })),
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
          // Direct document ID
          documentIds.push(file.id);
        } else if (file.type === 'workspace') {
          // Fetch all document IDs from this workspace
          const result = await this.workspaceDocumentService.findAllByWorkspace(file.id, {
            limit: 1000,
            status: DocumentStatus.COMPLETED,
          });
          // Extract document IDs
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
          portToDocIds.get(portId)!.add(file.id);
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
