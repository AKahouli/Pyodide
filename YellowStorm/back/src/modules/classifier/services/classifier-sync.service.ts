import { Injectable } from '@nestjs/common';
import AdmZip = require('adm-zip');
import { ClassifierAssignmentRepository } from '../persistence/classifier-assignment.repository';
import { ClassifierFolderRepository } from '../persistence/classifier-folder.repository';
import { DocumentService } from '../../document/document.service';
import { LoggerService } from '../../logger';
import { NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { ClassifierAccessService } from './classifier-access.service';
import { PgWorkspaceReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-read.adapter';
import { PgWorkspaceDocumentReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-document-read.adapter';

export interface SyncZipResult {
  filename: string;
  buffer: Buffer;
  fileCount: number;
  unclassifiedCount: number;
  failedCount: number;
}

@Injectable()
export class ClassifierSyncService {
  constructor(
    private readonly workspaceReadPort: PgWorkspaceReadAdapter,
    private readonly folders: ClassifierFolderRepository,
    private readonly assignments: ClassifierAssignmentRepository,
    private readonly documentReadPort: PgWorkspaceDocumentReadAdapter,
    private readonly documentService: DocumentService,
    private readonly access: ClassifierAccessService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ClassifierSyncService.name);
  }

  async buildWorkspaceZip(userId: string, workspaceId: string): Promise<SyncZipResult> {
    await this.access.assertWorkspaceAccess(workspaceId, userId);

    const workspace = await this.workspaceReadPort.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND);
    }

    const [folders, documents, assignments] = await Promise.all([
      this.folders.listByWorkspace(workspaceId),
      this.documentReadPort.find({ workspaceId, isFolder: false }),
      this.assignments.listByWorkspace(workspaceId),
    ]);

    const folderPathById = this.buildFolderPathMap(folders);
    const folderIdByDocId = new Map<string, string | null>(
      assignments.map((a) => [a.documentId, a.folderId]),
    );

    const rootName = this.sanitizeSegment(workspace.name) || 'workspace';
    const zip = new AdmZip();
    const usedPaths = new Set<string>();
    let unclassifiedCount = 0;
    let failedCount = 0;

    for (const doc of documents) {
      const folderId = folderIdByDocId.get(doc.id) ?? null;
      const folderPath = folderId ? folderPathById.get(folderId) : null;

      const segments: string[] = [rootName];
      if (folderPath) {
        segments.push(...folderPath);
      } else {
        unclassifiedCount++;
      }

      const safeName = this.sanitizeSegment(doc.originalName) || 'file';
      const finalName = this.dedupeFileName(segments, safeName, usedPaths);
      const entryPath = [...segments, finalName].join('/');

      if (!doc.path) {
        failedCount++;
        this.logger.warn('Sync: document has no blob path, skipping', {
          documentId: doc.id,
          workspaceId,
        });
        continue;
      }

      try {
        const buffer = await this.documentService.download(doc.path);
        zip.addFile(entryPath, buffer);
      } catch (err) {
        failedCount++;
        this.logger.warn('Sync: failed to download document, skipping', {
          documentId: doc.id,
          workspaceId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // Ensure every folder appears in the archive even if empty
    folderPathById.forEach((segments) => {
      if (segments.length === 0) return;
      const dirPath = [rootName, ...segments].join('/') + '/';
      // adm-zip exposes addFile for directories by passing an empty buffer + path ending with '/'
      if (!usedPaths.has(dirPath)) {
        zip.addFile(dirPath, Buffer.alloc(0));
        usedPaths.add(dirPath);
      }
    });

    const filename = this.buildArchiveName(workspace.name);
    const buffer = zip.toBuffer();

    this.logger.log('Workspace synced as ZIP', {
      workspaceId,
      userId,
      fileCount: documents.length - failedCount,
      unclassifiedCount,
      failedCount,
      sizeBytes: buffer.length,
    });

    return {
      filename,
      buffer,
      fileCount: documents.length - failedCount,
      unclassifiedCount,
      failedCount,
    };
  }

  // ───────── helpers ─────────

  private buildFolderPathMap(
    folders: Array<{ id: string; name: string; parentId: string | null }>,
  ): Map<string, string[]> {
    const byId = new Map<string, { name: string; parentId: string | null }>();
    folders.forEach((f) => {
      byId.set(f.id, {
        name: this.sanitizeSegment(f.name) || 'dossier',
        parentId: f.parentId,
      });
    });

    const pathById = new Map<string, string[]>();
    const resolve = (id: string, visited: Set<string>): string[] => {
      if (pathById.has(id)) return pathById.get(id) as string[];
      if (visited.has(id)) return []; // cycle guard
      visited.add(id);
      const node = byId.get(id);
      if (!node) return [];
      const path = node.parentId ? [...resolve(node.parentId, visited), node.name] : [node.name];
      pathById.set(id, path);
      return path;
    };

    byId.forEach((_v, id) => {
      resolve(id, new Set<string>());
    });

    return pathById;
  }

  private sanitizeSegment(input: string | undefined): string {
    if (!input) return '';
    return input
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .trim()
      .replace(/\.+$/, '')
      .slice(0, 200);
  }

  private dedupeFileName(segments: string[], candidate: string, used: Set<string>): string {
    const base = [...segments, candidate].join('/');
    if (!used.has(base)) {
      used.add(base);
      return candidate;
    }
    const dotIndex = candidate.lastIndexOf('.');
    const stem = dotIndex > 0 ? candidate.slice(0, dotIndex) : candidate;
    const ext = dotIndex > 0 ? candidate.slice(dotIndex) : '';
    let i = 1;
    while (true) {
      const next = `${stem} (${i})${ext}`;
      const nextPath = [...segments, next].join('/');
      if (!used.has(nextPath)) {
        used.add(nextPath);
        return next;
      }
      i++;
    }
  }

  private buildArchiveName(workspaceName: string): string {
    const safeName = this.sanitizeSegment(workspaceName) || 'workspace';
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `Yellowstorm-${safeName}-${yyyy}${mm}${dd}.zip`;
  }
}
