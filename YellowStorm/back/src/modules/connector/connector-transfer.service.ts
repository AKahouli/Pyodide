import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '../logger';
import { ConnectorAuthService } from './interfaces/connector-auth.interface';
import { ConnectorTransferAdapter } from './interfaces/connector-transfer.interface';
import { ConnectorService } from './connector.service';
import { M365TransferAdapter } from './adapters/m365-transfer.adapter';
import { WorkspaceDocumentService } from '../workspace/workspace-document.service';
import { DocumentService } from '../document/document.service';

export interface TransferResult {
  success: boolean;
  workspaceDocumentId?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  connectorItemId?: string;
  webUrl?: string;
  error?: string;
}

@Injectable()
export class ConnectorTransferService {
  private readonly adapters: Map<string, ConnectorTransferAdapter> = new Map();

  constructor(
    private readonly connectorService: ConnectorService,
    @Inject('ConnectorAuthService')
    private readonly auth: ConnectorAuthService,
    private readonly workspaceDocService: WorkspaceDocumentService,
    private readonly documentService: DocumentService,
    private readonly logger: LoggerService,
    private readonly m365Adapter: M365TransferAdapter,
  ) {
    this.logger.setContext(ConnectorTransferService.name);
    this.adapters.set('m365', this.m365Adapter);
    this.adapters.set('microsoft365', this.m365Adapter);
  }

  registerAdapter(provider: string, adapter: ConnectorTransferAdapter): void {
    this.adapters.set(provider, adapter);
  }

  private async resolveAdapter(connectorId: string): Promise<{
    adapter: ConnectorTransferAdapter;
    authHeaders: Record<string, string>;
    userId: string;
    connectorSlug: string;
  }> {
    const connector = await this.connectorService.findById(connectorId);

    let adapter = this.adapters.get(connector.slug);
    if (!adapter) {
      adapter = this.adapters.get(connectorId);
    }
    if (!adapter) {
      throw new Error(
        `No transfer adapter registered for connector "${connector.slug}" (id: ${connectorId}). ` +
        `Available: ${[...this.adapters.keys()].join(', ')}`,
      );
    }

    const userId = connector.createdBy.toString();
    const auth = await this.auth.resolveRuntimeAuth(userId, {
      authSourceType: connector.authSourceType,
      connectedAppKey: connector.connectedAppKey,
      runtimeAuthConfig: connector.runtimeAuthConfig || {},
      connectorId,
    });

    if (!auth.headers['Authorization']) {
      throw new Error(
        `Could not resolve auth for connector "${connector.slug}". ` +
        `Ensure the connected app is linked and has an active token.`,
      );
    }

    return { adapter, authHeaders: auth.headers, userId, connectorSlug: connector.slug };
  }

  async importToWorkspace(
    callerUserId: string,
    connectorId: string,
    itemRef: Record<string, unknown>,
    workspaceId: string,
    options?: { filename?: string; mimeType?: string },
  ): Promise<TransferResult> {
    try {
      const { adapter, authHeaders, userId } = await this.resolveAdapter(connectorId);
      const resolvedUserId = callerUserId || userId;

      this.logger.log('Importing connector item to workspace', {
        connectorId,
        workspaceId,
        provider: adapter.provider,
      });

      const { buffer, filename, mimeType } = await adapter.downloadItem(itemRef, authHeaders);

      const doc = await this.workspaceDocService.uploadSmallFile(
        workspaceId,
        resolvedUserId,
        buffer,
        options?.filename || filename,
        options?.mimeType || mimeType,
      );

      this.logger.log('Import complete', {
        workspaceDocumentId: doc.id,
        filename: doc.originalName,
        size: doc.size,
      });

      return {
        success: true,
        workspaceDocumentId: doc.id,
        filename: doc.originalName,
        mimeType: doc.mimeType,
        size: doc.size,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error('Import failed', { connectorId, workspaceId, error: err.message });
      return { success: false, error: err.message };
    }
  }

  async exportFromWorkspace(
    callerUserId: string,
    connectorId: string,
    targetRef: Record<string, unknown>,
    workspaceId: string,
    documentId: string,
    mode: 'create' | 'update' = 'create',
    options?: { filename?: string },
  ): Promise<TransferResult> {
    try {
      const { adapter, authHeaders } = await this.resolveAdapter(connectorId);

      this.logger.log('Exporting workspace document to connector', {
        connectorId,
        workspaceId,
        documentId,
        provider: adapter.provider,
        mode,
      });

      const doc = await this.workspaceDocService.findById(workspaceId, documentId);
      if (!doc) {
        throw new Error(`Workspace document not found: ${documentId}`);
      }

      if (doc.isFolder) {
        throw new Error(`Cannot download folders directly: ${documentId}`);
      }

      const buffer = await this.documentService.download(doc.path!);
      const filename = options?.filename || doc.originalName;

      const result = await adapter.uploadItem(
        targetRef,
        authHeaders,
        buffer,
        filename,
        doc.mimeType,
        mode,
      );

      this.logger.log('Export complete', {
        connectorItemId: result.itemId,
        filename: result.name,
      });

      return {
        success: true,
        connectorItemId: result.itemId,
        filename: result.name,
        webUrl: result.webUrl,
        size: buffer.length,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error('Export failed', { connectorId, workspaceId, documentId, error: err.message });
      return { success: false, error: err.message };
    }
  }
}
