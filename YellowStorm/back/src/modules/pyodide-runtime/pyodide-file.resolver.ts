import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isObjectId } from '@common/postgres/object-id';
import { WorkspaceDocumentService } from '../workspace/workspace-document.service';
import { GuardedUrlDownloaderService } from '../workspace/services/guarded-url-downloader.service';
import { PgWorkspaceStore } from '../workspace/stores/postgres/pg-workspace-store';
import { PgShareStore } from '../workspace/stores/postgres/pg-share-store';
import type { DocumentResponse } from '../workspace/interfaces/workspace-document.interface';
import {
  PyodideArtifactReference,
  PyodideOutputFile,
  PyodideResolvedInputFile,
} from './pyodide-runtime.types';

/** A file error surfaced to the MCP as a clean, stable error code. */
export class PyodideFileError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const DEFAULT_MIME = 'application/octet-stream';

/** Workspace uploads reject a mismatched MIME for several extensions, so infer it from the file name. */
const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  json: 'application/json',
  md: 'text/markdown',
  html: 'text/html',
  xml: 'application/xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

function inferMimeType(name: string, fallback?: string): string {
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return MIME_BY_EXTENSION[extension] ?? (fallback && fallback !== DEFAULT_MIME ? fallback : DEFAULT_MIME);
}

/**
 * Resolves the model's logical file references to bounded bytes for the acting user (§27): a workspace
 * document id or an exact name, authorized against the trusted workspace coming from the platform context.
 * Output files are persisted back as workspace documents and returned as references (never content via MCP).
 */
@Injectable()
export class PyodideFileResolver {
  constructor(
    private readonly documents: WorkspaceDocumentService,
    private readonly downloader: GuardedUrlDownloaderService,
    private readonly workspaceStore: PgWorkspaceStore,
    private readonly shareStore: PgShareStore,
    private readonly config: ConfigService,
  ) {}

  async resolveInputs(
    userId: string,
    workspaceId: string,
    names: string[],
  ): Promise<PyodideResolvedInputFile[]> {
    if (names.length === 0) return [];
    if (!isObjectId(workspaceId)) {
      throw new PyodideFileError('PYODIDE_EXECUTION_ERROR', 'A trusted workspace context is required to read files.');
    }
    await this.assertAccess(userId, workspaceId, false);

    const maxTotal = this.config.get<number>('pyodideRuntime.maxInputFileBytes', 2 * 1024 * 1024);
    const resolved: PyodideResolvedInputFile[] = [];
    let total = 0;

    for (const name of names) {
      const document = await this.resolveDocument(workspaceId, name);
      const remaining = maxTotal - total;
      if (remaining <= 0) {
        throw new PyodideFileError('PYODIDE_REQUEST_TOO_LARGE', 'The input files exceeded the configured limit.');
      }
      const { url } = await this.documents.getDownloadUrl(workspaceId, document.id);
      const { data } = await this.downloader.download(url, { maxBytes: remaining, deadlineMs: 30_000 });
      total += data.length;
      resolved.push({
        name: document.originalName,
        mimeType: document.mimeType || DEFAULT_MIME,
        contentBase64: data.toString('base64'),
      });
    }
    return resolved;
  }

  async persistOutputs(
    userId: string,
    workspaceId: string,
    files: PyodideOutputFile[],
  ): Promise<PyodideArtifactReference[]> {
    if (files.length === 0) return [];
    if (!isObjectId(workspaceId)) {
      throw new PyodideFileError('PYODIDE_EXECUTION_ERROR', 'A trusted workspace context is required to save files.');
    }
    await this.assertAccess(userId, workspaceId, true);

    const maxTotal = this.config.get<number>('pyodideRuntime.maxOutputFileBytes', 512 * 1024);
    const artifacts: PyodideArtifactReference[] = [];
    let total = 0;

    for (const file of files) {
      const buffer = Buffer.from(file.contentBase64, 'base64');
      total += buffer.length;
      if (total > maxTotal) {
        throw new PyodideFileError('PYODIDE_RESULT_TOO_LARGE', 'The output files exceeded the configured limit.');
      }
      const document = await this.documents.uploadSmallFile(
        workspaceId,
        userId,
        buffer,
        file.name,
        inferMimeType(file.name, file.mimeType),
      );
      artifacts.push({
        name: document.originalName,
        sizeBytes: document.size ?? buffer.length,
        contentType: document.mimeType,
        documentId: document.id,
      });
    }
    return artifacts;
  }

  private async resolveDocument(workspaceId: string, name: string): Promise<DocumentResponse> {
    const page = await this.documents.findAllByWorkspace(workspaceId, { search: name, limit: 50 });
    const target = name.toLowerCase();
    const exact = page.documents.find(
      (document) => !document.isFolder && document.originalName.toLowerCase() === target,
    );
    if (!exact) {
      throw new PyodideFileError('PYODIDE_EXECUTION_ERROR', `File not found in the workspace: ${name}.`);
    }
    return exact;
  }

  /** Mirrors WorkspaceAccessGuard: owner, public (read-only) or an explicit share. */
  private async assertAccess(userId: string, workspaceId: string, needWrite: boolean): Promise<void> {
    const workspace = await this.workspaceStore.findById(workspaceId);
    if (!workspace) {
      throw new PyodideFileError('PYODIDE_EXECUTION_ERROR', 'Workspace not found.');
    }
    if (workspace.createdBy === userId) return;
    if (workspace.isPublic && !needWrite) return;
    const share = await this.shareStore.findOneByWorkspaceAndUser(workspaceId, userId);
    if (!share || (needWrite && share.permission !== 'readwrite')) {
      throw new PyodideFileError('PYODIDE_EXECUTION_ERROR', 'You do not have access to this workspace.');
    }
  }
}
