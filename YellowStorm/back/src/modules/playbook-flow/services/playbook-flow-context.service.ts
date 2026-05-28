import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { DocumentStatus } from '@modules/workspace/schemas/workspace-document.schema';
import { Workspace, WorkspaceDocument } from '@modules/workspace/schemas/workspace.schema';
import { WorkspaceSetting, WorkspaceSettingDocument } from '@modules/workspace/schemas/workspace-setting.schema';
import { IGrpcAgent, IGrpcWorkspaceContext } from '@modules/agent/interfaces/agent.interface';

@Injectable()
export class PlaybookFlowContextService {
  constructor(
    @InjectModel(Workspace.name) private readonly workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(WorkspaceSetting.name) private readonly workspaceSettingModel: Model<WorkspaceSettingDocument>,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowContextService'); }

  async buildWorkspaceContexts(workspaceIds: string[]): Promise<IGrpcWorkspaceContext[]> {
    if (!workspaceIds?.length) return [];
    const contexts: IGrpcWorkspaceContext[] = [];
    for (const wsId of workspaceIds) {
      try {
        const ws = await this.workspaceModel.findById(wsId).lean().exec();
        const workspaceName = ws?.storagePrefix || ws?.alias || wsId;
        let settings: WorkspaceSettingDocument | null = null;
        if (ws?.settings) settings = await this.workspaceSettingModel.findById(ws.settings).lean().exec() as any;

        const result = await this.workspaceDocumentService.findAllByWorkspace(wsId, { limit: 1000, status: DocumentStatus.COMPLETED });
        contexts.push({
          workspace_id: wsId,
          workspace_name: workspaceName,
          chunks: settings?.chunks,
          hybrid_search: settings?.hybridSearch,
          instruction: settings?.instruction,
          tag: settings?.tag,
          workspace_documents: result.documents.map((doc: any) => ({
            _id: doc.id, filename: doc.filename || '', filepath: doc.path,
            in_memory: false, language: doc.detected_language || 'fr',
            indexing_token: doc.chunk_size || 1200, workspace_id: wsId,
            workspace_name: workspaceName, file_name: doc.filename || '',
            createdAt: doc.createdAt,
          })),
        });
      } catch (err) {
        this.logger.warn('Failed to build workspace context', { wsId, error: (err as Error).message });
      }
    }
    return contexts;
  }

  async resolveAgentBrainContexts(agents: IGrpcAgent[]): Promise<void> {
    const allWsIds = [...new Set(agents.flatMap((a) => a.brain_context.map((c) => c.workspace_id)))];
    if (!allWsIds.length) return;

    const contextMap = new Map<string, IGrpcWorkspaceContext>();
    await Promise.allSettled(allWsIds.map(async (wsId) => {
      const result = await this.workspaceDocumentService.findAllByWorkspace(wsId, { limit: 1000, status: DocumentStatus.COMPLETED });
      const ws = await this.workspaceModel.findById(wsId).lean().exec();
      const workspaceName = ws?.storagePrefix || ws?.alias || wsId;
      let settings: WorkspaceSettingDocument | null = null;
      if (ws?.settings) settings = await this.workspaceSettingModel.findById(ws.settings).lean().exec() as any;
      contextMap.set(wsId, {
        workspace_id: wsId,
        workspace_name: workspaceName,
        chunks: settings?.chunks, hybrid_search: settings?.hybridSearch,
        instruction: settings?.instruction, tag: settings?.tag,
        workspace_documents: result.documents.map((doc: any) => ({
          _id: doc.id, filename: doc.filename || '', filepath: doc.path,
          in_memory: false, language: doc.detected_language || 'fr',
          indexing_token: doc.chunk_size || 1200, workspace_id: wsId,
          workspace_name: workspaceName, file_name: doc.filename || '',
          createdAt: doc.createdAt,
        })),
      });
    }));

    for (const agent of agents) {
      agent.brain_context = agent.brain_context
        .map((c) => contextMap.get(c.workspace_id))
        .filter(Boolean) as IGrpcWorkspaceContext[];
    }
  }
}
