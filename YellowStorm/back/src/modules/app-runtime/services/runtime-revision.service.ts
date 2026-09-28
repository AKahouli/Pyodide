import { createHash } from 'crypto';
import {
  BadRequestException, 
  Injectable, 
  Logger, 
  NotFoundException, 
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from '@modules/document/document.service';
import {
  DEFAULT_STARTER_MANIFEST_KEY,
  DEFAULT_STARTER_REVISION_ID,
  resolveEmbeddedStarter,
  type StarterManifestFile,
} from '../constants/starter-revisions';
import { STARTER_REACT_VITE_V1_REVISION_ID } from '../constants/starter-react-vite-v1';
import { blobObjectKey } from '../utils/blob-object-key';
import { 
  type SourceRevisionFileRecord,  
} from '../persistence/runtime-source-revision.store';
import { PgRuntimeSourceRevisionStore } from '../persistence/pg-runtime-source-revision.store';

export interface RevisionManifest {
  revisionId: string;
  workspaceId: string;
  parentRevisionId: string | null;
  manifestHash: string;
  manifestObjectKey: string;
  files: SourceRevisionFileRecord[];
}

interface CephStarterManifestJson {
  revisionId?: string;
  parentRevisionId?: string | null;
  files?: Array<{
    path?: string;
    sha256?: string;
    objectKey?: string;
    size?: number;
  }>;
}

@Injectable()
export class RuntimeRevisionService {
  private readonly logger = new Logger(RuntimeRevisionService.name);
  private starterCache: RevisionManifest | null = null;

  constructor(
    private readonly store: PgRuntimeSourceRevisionStore,
    private readonly documents: DocumentService,
    private readonly config: ConfigService,
  ) {}

  get starterRevisionId(): string {
    return (
      this.config.get<string>('appRuntime.starterRevisionId') ||
      DEFAULT_STARTER_REVISION_ID
    );
  }

  get starterManifestKey(): string {
    return (
      this.config.get<string>('appRuntime.starterManifestKey') ||
      DEFAULT_STARTER_MANIFEST_KEY
    );
  }

  /**
   * Resolve a revision the session is allowed to read: the global Ceph starter,
   * or a workspace-owned revision document.
   */
  async getAuthorizedRevision(
    workspaceId: string,
    revisionId: string,
  ): Promise<RevisionManifest> {
    if (revisionId === this.starterRevisionId) {
      return this.getStarterManifest();
    }

    const doc = await this.store.findByWorkspaceAndRevision(workspaceId, revisionId);

    if (!doc) {
      throw new NotFoundException(
        `Revision ${revisionId} not found for workspace ${workspaceId}`,
      );
    }

    return {
      revisionId: doc.revisionId,
      workspaceId: doc.workspaceId,
      parentRevisionId: doc.parentRevisionId ?? null,
      manifestHash: doc.manifestHash,
      manifestObjectKey: doc.manifestObjectKey,
      files: doc.files,
    };
  }

  /** Read a single revision file from its content-addressed Ceph blob. */
  async readRevisionFileText(
    workspaceId: string,
    revisionId: string,
    relativePath: string,
  ): Promise<string | null> {
    const revision = await this.getAuthorizedRevision(workspaceId, revisionId);
    const file = revision.files.find((entry) => entry.path === relativePath);
    if (!file) return null;
    const raw = await this.documents.download(file.objectKey);
    return raw.toString('utf8');
  }

  /**
   * Ensure the workspace has a row for the starter revision (idempotent).
   * Binding still points `latestRevisionId` at the shared starter id; this
   * records the file list for later workspace-local children.
   */
  async ensureStarterRevision(workspaceId: string): Promise<RevisionManifest> {
    const starter = await this.getStarterManifest();
    const existing = await this.store.findByWorkspaceAndRevision(workspaceId, starter.revisionId);

    if (existing) {
      return {
        revisionId: existing.revisionId,
        workspaceId: existing.workspaceId,
        parentRevisionId: existing.parentRevisionId ?? null,
        manifestHash: existing.manifestHash,
        manifestObjectKey: existing.manifestObjectKey,
        files: existing.files,
      };
    }

    const created = await this.store.createIfNotExists({
      revisionId: starter.revisionId,
      workspaceId,
      parentRevisionId: null,
      manifestHash: starter.manifestHash,
      manifestObjectKey: starter.manifestObjectKey,
      files: starter.files,
      createdByToolCallId: null,
    });

    return { ...starter, workspaceId: created.workspaceId };
  }

  async listFiles(
    workspaceId: string,
    revisionId: string,
  ): Promise<{ revisionId: string; files: SourceRevisionFileRecord[] }> {
    const revision = await this.getAuthorizedRevision(workspaceId, revisionId);
    return { revisionId: revision.revisionId, files: revision.files };
  }

  /**
   * Map requested relative paths to Ceph object keys from the authorized
   * revision only — never trust a client-supplied prefix.
   */
  resolveObjectKeys(
    revision: RevisionManifest,
    paths: string[],
  ): Array<{ path: string; objectKey: string; sha256: string; size: number }> {
    const byPath = new Map(revision.files.map((f) => [f.path, f]));
    const items: Array<{
      path: string;
      objectKey: string;
      sha256: string;
      size: number;
    }> = [];

    for (const relative of paths) {
      const normalized = this.normalizeRelativePath(relative);
      const file = byPath.get(normalized);
      if (!file) {
        throw new NotFoundException(
          `Path ${normalized} is not in revision ${revision.revisionId}`,
        );
      }
      items.push({
        path: normalized,
        objectKey: file.objectKey,
        sha256: file.sha256,
        size: file.size,
      });
    }

    return items;
  }

  normalizeRelativePath(relative: string): string {
    const normalized = relative.replace(/^\/+/, '').replace(/\\/g, '/');
    if (
      !normalized ||
      normalized.includes('..') ||
      normalized.startsWith('/') ||
      normalized.includes('\0')
    ) {
      throw new BadRequestException(`Invalid source path: ${relative}`);
    }
    return normalized;
  }

  /** True when the workspace (or system starter) owns this revision id. */
  async revisionExists(workspaceId: string, revisionId: string): Promise<boolean> {
    if (revisionId === this.starterRevisionId) {
      return true;
    }
    return this.store.existsByWorkspaceAndRevision(workspaceId, revisionId);
  }

  /**
   * Persist a workspace revision snapshot to Ceph (content-addressed blobs +
   * manifest) and Postgres. Called by the browser runtime after each mutating tool.
   */
  async commitWorkspaceRevision(input: {
    workspaceId: string;
    revisionId: string;
    parentRevisionId?: string | null;
    files: Array<{ path: string; content: string }>;
    toolCallId?: string | null;
  }): Promise<RevisionManifest> {
    const { workspaceId, revisionId } = input;
    const parentRevisionId = input.parentRevisionId ?? null;

    if (!revisionId || revisionId === this.starterRevisionId) {
      throw new BadRequestException('Cannot overwrite the system starter revision');
    }

    const existing = await this.store.findByWorkspaceAndRevision(workspaceId, revisionId);
    if (existing) {
      return {
        revisionId: existing.revisionId,
        workspaceId: existing.workspaceId,
        parentRevisionId: existing.parentRevisionId ?? null,
        manifestHash: existing.manifestHash,
        manifestObjectKey: existing.manifestObjectKey,
        files: existing.files,
      };
    }

    if (parentRevisionId) {
      const parentOk = await this.revisionExists(workspaceId, parentRevisionId);
      if (!parentOk) {
        throw new BadRequestException(
          `Parent revision ${parentRevisionId} is not authorized for workspace ${workspaceId}`,
        );
      }
    }

    const manifestFiles: SourceRevisionFileRecord[] = [];
    for (const raw of input.files) {
      const path = this.normalizeRelativePath(raw.path);
      const body = Buffer.from(raw.content, 'utf8');
      const sha256 = createHash('sha256').update(body).digest('hex');
      const objectKey = blobObjectKey(sha256);

      if (!(await this.documents.exists(objectKey))) {
        await this.documents.upload(body, path.split('/').pop() || path, 'text/plain', {
          generateUniqueName: false,
          customFileName: objectKey,
        });
      }

      manifestFiles.push({
        path,
        sha256,
        objectKey,
        size: body.length,
      });
    }

    manifestFiles.sort((a, b) => a.path.localeCompare(b.path));

    const manifestPayload = JSON.stringify({
      revisionId,
      workspaceId,
      parentRevisionId,
      files: manifestFiles,
    });
    const manifestHash = createHash('sha256').update(manifestPayload).digest('hex');
    const manifestObjectKey = `appbuilder/manifests/${workspaceId}/${revisionId}.json`;

    await this.documents.upload(
      Buffer.from(manifestPayload, 'utf8'),
      `${revisionId}.json`,
      'application/json',
      {
        generateUniqueName: false,
        customFileName: manifestObjectKey,
      },
    );

    await this.store.createIfNotExists({
      revisionId,
      workspaceId,
      parentRevisionId,
      manifestHash,
      manifestObjectKey,
      files: manifestFiles,
      createdByToolCallId: input.toolCallId ?? null,
    });

    this.logger.log(
      `Committed workspace revision workspaceId=${workspaceId} revisionId=${revisionId} files=${manifestFiles.length}`,
    );

    return {
      revisionId,
      workspaceId,
      parentRevisionId,
      manifestHash,
      manifestObjectKey,
      files: manifestFiles,
    };
  }

  /**
   * Create a new revision from a base revision plus additional (or replacement)
   * files. Only the new files are uploaded to Ceph; existing blobs are reused.
   */
  async patchRevisionWithFiles(input: {
    workspaceId: string;
    baseRevisionId: string;
    newRevisionId: string;
    additionalFiles: Array<{ path: string; content: string }>;
  }): Promise<RevisionManifest> {
    const base = await this.getAuthorizedRevision(input.workspaceId, input.baseRevisionId);

    const newFiles: SourceRevisionFileRecord[] = [];
    for (const raw of input.additionalFiles) {
      const path = this.normalizeRelativePath(raw.path);
      const body = Buffer.from(raw.content, 'utf8');
      const sha256 = createHash('sha256').update(body).digest('hex');
      const objectKey = blobObjectKey(sha256);

      if (!(await this.documents.exists(objectKey))) {
        await this.documents.upload(body, path.split('/').pop() || path, 'text/plain', {
          generateUniqueName: false,
          customFileName: objectKey,
        });
      }
      newFiles.push({ path, sha256, objectKey, size: body.length });
    }

    const fileMap = new Map(base.files.map((f) => [f.path, f]));
    for (const f of newFiles) {
      fileMap.set(f.path, f);
    }
    const manifestFiles = [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path));

    const manifestPayload = JSON.stringify({
      revisionId: input.newRevisionId,
      workspaceId: input.workspaceId,
      parentRevisionId: input.baseRevisionId,
      files: manifestFiles,
    });
    const manifestHash = createHash('sha256').update(manifestPayload).digest('hex');
    const manifestObjectKey = `appbuilder/manifests/${input.workspaceId}/${input.newRevisionId}.json`;

    await this.documents.upload(
      Buffer.from(manifestPayload, 'utf8'),
      `${input.newRevisionId}.json`,
      'application/json',
      { generateUniqueName: false, customFileName: manifestObjectKey },
    );

    await this.store.createIfNotExists({
      revisionId: input.newRevisionId,
      workspaceId: input.workspaceId,
      parentRevisionId: input.baseRevisionId,
      manifestHash,
      manifestObjectKey,
      files: manifestFiles,
      createdByToolCallId: null,
    });

    this.logger.log(
      `Patched revision workspaceId=${input.workspaceId} base=${input.baseRevisionId} new=${input.newRevisionId} files=${manifestFiles.length}`,
    );

    return {
      revisionId: input.newRevisionId,
      workspaceId: input.workspaceId,
      parentRevisionId: input.baseRevisionId,
      manifestHash,
      manifestObjectKey,
      files: manifestFiles,
    };
  }

  /**
   * Branch a fresh revision from an existing one without mutating it.
   */
  async branchRevision(
    workspaceId: string,
    sourceRevisionId: string,
  ): Promise<RevisionManifest> {
    const source = await this.getAuthorizedRevision(workspaceId, sourceRevisionId);

    const revisionIds = await this.store.listRevisionIds(workspaceId);
    let maxNumber = 0;
    for (const rid of revisionIds) {
      const match = /^rev_(\d+)$/.exec(rid);
      if (match) {
        maxNumber = Math.max(maxNumber, Number.parseInt(match[1]!, 10));
      }
    }
    const newRevisionId = `rev_${maxNumber + 1}`;

    this.logger.log(
      `Branching revision workspaceId=${workspaceId} source=${sourceRevisionId} new=${newRevisionId} files=${source.files.length}`,
    );

    return this.patchRevisionWithFiles({
      workspaceId,
      baseRevisionId: sourceRevisionId,
      newRevisionId,
      additionalFiles: [],
    });
  }

  async getStarterManifest(): Promise<RevisionManifest> {
    if (this.starterCache) {
      return this.starterCache;
    }

    const fromCeph = await this.tryLoadStarterFromCeph();
    this.starterCache = fromCeph ?? this.embeddedStarterManifest();
    return this.starterCache;
  }

  /** Test helper — clears the in-process Ceph/embedded cache. */
  clearStarterCache(): void {
    this.starterCache = null;
  }

  private async tryLoadStarterFromCeph(): Promise<RevisionManifest | null> {
    const key = this.starterManifestKey;
    try {
      const raw = await this.documents.download(key);
      const parsed = JSON.parse(raw.toString('utf8')) as CephStarterManifestJson;
      const files = this.normalizeManifestFiles(parsed.files);
      if (files.length === 0) {
        this.logger.warn(`Starter manifest ${key} has no usable files; using embedded fallback`);
        return null;
      }

      const revisionId = parsed.revisionId || this.starterRevisionId;
      const manifestHash = createHash('sha256').update(raw).digest('hex');

      this.logger.log(
        `Loaded starter revision ${revisionId} from Ceph key=${key} files=${files.length}`,
      );

      return {
        revisionId,
        workspaceId: '_system',
        parentRevisionId: parsed.parentRevisionId ?? null,
        manifestHash,
        manifestObjectKey: key,
        files,
      };
    } catch (error) {
      this.logger.warn(
        `Could not load starter manifest from Ceph (${key}); using embedded fallback: ${
          (error as Error)?.message ?? error
        }`,
      );
      return null;
    }
  }

  private embeddedStarterManifest(): RevisionManifest {
    const embedded =
      resolveEmbeddedStarter(this.starterRevisionId) ??
      resolveEmbeddedStarter(STARTER_REACT_VITE_V1_REVISION_ID);
    if (!embedded) {
      throw new Error(`No embedded starter for revision ${this.starterRevisionId}`);
    }
    const files = embedded.files.map((f) => ({ ...f }));
    const payload = JSON.stringify({
      revisionId: embedded.revisionId,
      parentRevisionId: null,
      files,
    });
    return {
      revisionId: embedded.revisionId,
      workspaceId: '_system',
      parentRevisionId: null,
      manifestHash: createHash('sha256').update(payload).digest('hex'),
      manifestObjectKey: embedded.manifestKey,
      files,
    };
  }

  private normalizeManifestFiles(
    files: CephStarterManifestJson['files'],
  ): StarterManifestFile[] {
    if (!Array.isArray(files)) return [];
    const out: StarterManifestFile[] = [];
    for (const f of files) {
      if (
        typeof f?.path !== 'string' ||
        typeof f?.sha256 !== 'string' ||
        typeof f?.objectKey !== 'string' ||
        typeof f?.size !== 'number'
      ) {
        continue;
      }
      out.push({
        path: f.path,
        sha256: f.sha256,
        objectKey: f.objectKey,
        size: f.size,
      });
    }
    return out;
  }
}
