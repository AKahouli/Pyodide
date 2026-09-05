import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '../logger';
import { ConnectorAuthService } from './interfaces/connector-auth.interface';
import { ConnectorTransferAdapter } from './interfaces/connector-transfer.interface';
import { ConnectorService } from './connector.service';
import { M365TransferAdapter } from './adapters/m365-transfer.adapter';
import { WorkspaceDocumentService } from '../workspace/workspace-document.service';
import { WorkspaceShareService } from '../workspace/workspace-share.service';
import { DocumentService } from '../document/document.service';
import { stripLeadingTrailingChar } from '@common/utils';

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

export interface ImportTransferResult {
  success: boolean;
  mode: 'file' | 'files' | 'folder';
  workspaceId: string;
  imported: Array<TransferResult & { finalFilename?: string; sourcePath?: string; collisionResolved?: boolean }>;
  summary: { requested: number; imported: number; failed: number };
  errors: Array<{ sourcePath?: string; error: string }>;
}

@Injectable()
export class ConnectorTransferService {
  private readonly adapters: Map<string, ConnectorTransferAdapter> = new Map();

  constructor(
    private readonly connectorService: ConnectorService,
    @Inject('ConnectorAuthService')
    private readonly auth: ConnectorAuthService,
    private readonly workspaceDocService: WorkspaceDocumentService,
    private readonly workspaceShareService: WorkspaceShareService,
    private readonly documentService: DocumentService,
    private readonly logger: LoggerService,
    private readonly m365Adapter: M365TransferAdapter,
  ) {
    this.logger.setContext(ConnectorTransferService.name);
    this.adapters.set('m365', this.m365Adapter);
    this.adapters.set('microsoft365', this.m365Adapter);
    this.adapters.set('mcp-spo', this.m365Adapter);
    this.adapters.set('mcp-m365', this.m365Adapter);
    this.adapters.set('sharepoint', this.m365Adapter);
  }

  registerAdapter(provider: string, adapter: ConnectorTransferAdapter): void {
    this.adapters.set(provider, adapter);
  }

  private async resolveAdapter(connectorId: string, userId: string): Promise<{
    adapter: ConnectorTransferAdapter;
    authHeaders: Record<string, string>;
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

    return { adapter, authHeaders: auth.headers, connectorSlug: connector.slug };
  }

  private sanitizePathSegment(value: string): string {
    return stripLeadingTrailingChar(
      value.replace(/[^a-zA-Z0-9._-]+/g, '_'),
      '_',
    ).toLowerCase();
  }

  private buildCollisionFilename(filename: string, sourcePath: string, usedNames: Set<string>): string {
    const dotIndex = filename.lastIndexOf('.');
    const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
    const ext = dotIndex > 0 ? filename.slice(dotIndex) : '';
    const parts = sourcePath
      .split('/')
      .filter(Boolean)
      .slice(0, -1)
      .map((segment) => this.sanitizePathSegment(segment))
      .filter(Boolean);

    const suffixSeed = parts.length > 0 ? parts.slice(-3).join('_') : 'imported';
    let candidate = `${base}__${suffixSeed}${ext}`;
    let counter = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${base}__${suffixSeed}_${counter}${ext}`;
      counter += 1;
    }
    return candidate;
  }

  async importToWorkspace(
    callerUserId: string,
    connectorId: string,
    workspaceId: string,
    options: {
      mode: 'file' | 'files' | 'folder';
      itemRef?: Record<string, unknown>;
      itemRefs?: Record<string, unknown>[];
      recursive?: boolean;
      flatten?: boolean;
      filename?: string;
      mimeType?: string;
    },
  ): Promise<ImportTransferResult> {
    await this.workspaceShareService.assertUserHasWriteAccess(callerUserId, workspaceId);

    try {
      const { adapter, authHeaders } = await this.resolveAdapter(connectorId, callerUserId);
      const mode = options.mode || 'file';

      if (options.flatten === false) {
        throw new Error('Non-flattened folder imports are not supported yet');
      }

      const itemRefs = mode === 'files'
        ? (options.itemRefs || [])
        : (options.itemRef ? [options.itemRef] : []);

      if (itemRefs.length === 0) {
        throw new Error('At least one item reference is required for import');
      }

      const candidates = adapter.resolveImportCandidates
        ? (
          await Promise.all(
            itemRefs.map((itemRef) => adapter.resolveImportCandidates!(itemRef, authHeaders, { recursive: options.recursive ?? true })),
          )
        ).flat()
        : itemRefs.map((itemRef) => ({
          itemRef,
          filename: options.filename || 'imported-file',
          mimeType: options.mimeType || 'application/octet-stream',
          sourcePath: options.filename || 'imported-file',
        }));

      const existingDocuments = await this.workspaceDocService.findAllByWorkspace(workspaceId, { limit: 1000 });
      const usedNames = new Set(
        existingDocuments.documents.map((doc) => String(doc.originalName || '').toLowerCase()).filter(Boolean),
      );
      const imported: ImportTransferResult['imported'] = [];
      const errors: ImportTransferResult['errors'] = [];

      this.logger.log('Importing connector item to workspace', {
        connectorId,
        workspaceId,
        provider: adapter.provider,
        mode,
        candidateCount: candidates.length,
      });

      for (const [index, candidate] of candidates.entries()) {
        try {
          const isSingleImport = mode === 'file' && candidates.length === 1;
          let requestedFilename = isSingleImport && options.filename
            ? options.filename
            : candidate.filename;

          const normalizedRequested = requestedFilename.toLowerCase();
          let collisionResolved = false;
          if (usedNames.has(normalizedRequested)) {
            requestedFilename = this.buildCollisionFilename(requestedFilename, candidate.sourcePath, usedNames);
            collisionResolved = true;
          }
          usedNames.add(requestedFilename.toLowerCase());

          const { buffer, filename, mimeType } = await adapter.downloadItem(candidate.itemRef, authHeaders);
          const finalFilename = requestedFilename || filename;
          const finalMimeType = (isSingleImport && options.mimeType)
            ? options.mimeType
            : (candidate.mimeType || mimeType);
          const doc = await this.workspaceDocService.uploadSmallFile(
            workspaceId,
            callerUserId,
            buffer,
            finalFilename,
            finalMimeType,
          );

          imported.push({
            success: true,
            workspaceDocumentId: doc.id,
            filename: doc.originalName,
            finalFilename,
            mimeType: doc.mimeType,
            size: doc.size,
            sourcePath: candidate.sourcePath,
            collisionResolved,
          });

          this.logger.log('Import complete', {
            workspaceDocumentId: doc.id,
            filename: doc.originalName,
            size: doc.size,
            sourcePath: candidate.sourcePath,
            importIndex: index,
          });
        } catch (error) {
          const err = error as Error;
          errors.push({ sourcePath: candidate.sourcePath, error: err.message });
          imported.push({
            success: false,
            filename: candidate.filename,
            finalFilename: candidate.filename,
            mimeType: candidate.mimeType,
            sourcePath: candidate.sourcePath,
            error: err.message,
          });
        }
      }

      return {
        success: errors.length === 0,
        mode,
        workspaceId,
        imported,
        summary: {
          requested: candidates.length,
          imported: imported.filter((item) => item.success).length,
          failed: errors.length,
        },
        errors,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error('Import failed', { connectorId, workspaceId, error: err.message });
      return {
        success: false,
        mode: options.mode || 'file',
        workspaceId,
        imported: [],
        summary: { requested: 0, imported: 0, failed: 1 },
        errors: [{ error: err.message }],
      };
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
      const { adapter, authHeaders } = await this.resolveAdapter(connectorId, callerUserId);

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
