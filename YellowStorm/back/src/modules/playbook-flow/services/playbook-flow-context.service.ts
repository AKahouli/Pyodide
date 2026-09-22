import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { DocumentStatus } from '@modules/workspace/interfaces/document-status.enum';
import {
  WORKSPACE_READ_PORT,
  WORKSPACE_SETTING_READ_PORT,
  type WorkspaceReadPort,
  type WorkspaceSettingReadPort,
} from '@modules/workspace/ports';
import { IGrpcAgent, IGrpcWorkspaceContext } from '@modules/agent/interfaces/agent.interface';

@Injectable()
export class PlaybookFlowContextService {
  constructor(
    @Inject(WORKSPACE_READ_PORT) private readonly workspaceReadPort: WorkspaceReadPort,
    @Inject(WORKSPACE_SETTING_READ_PORT) private readonly workspaceSettingReadPort: WorkspaceSettingReadPort,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowContextService'); }

  async buildWorkspaceContexts(workspaceIds: string[]): Promise<IGrpcWorkspaceContext[]> {
    if (!workspaceIds?.length) return [];
    const contexts: IGrpcWorkspaceContext[] = [];
    for (const wsId of workspaceIds) {
      try {
        const ws = await this.workspaceReadPort.findById(wsId);
        const workspaceName = ws?.storagePrefix || ws?.alias || wsId;
        let settings = null;
        if (ws?.settingsId) settings = await this.workspaceSettingReadPort.findById(ws.settingsId);

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
      const ws = await this.workspaceReadPort.findById(wsId);
      const workspaceName = ws?.storagePrefix || ws?.alias || wsId;
      let settings = null;
      if (ws?.settingsId) settings = await this.workspaceSettingReadPort.findById(ws.settingsId);
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
