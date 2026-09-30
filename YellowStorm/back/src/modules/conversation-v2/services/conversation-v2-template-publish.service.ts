import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DocumentService } from '@modules/document/document.service';
import { blobObjectKey } from '@modules/app-runtime/utils/blob-object-key';
import {
  templateManifestKey,
  templateRevisionId,
} from '../constants/template-catalog.constants';
import { extractTemplateArchive } from '../utils/template-zip.util';
import {
  analyzeTemplatePlatform,
  type TemplatePlatformReport,
} from '@modules/app-runtime/platform-kit/platform-template-report';
export interface PublishedTemplateRevision {
  revisionId: string;
  manifestObjectKey: string;
  manifestHash: string;
  fileCount: number;
  /** Manifest file list, also persisted to `conversation_v2.template_revisions`. */
  files: TemplateManifestFile[];
  /** What the Platform Kit will have to inject when a session uses this template. */
  platformReport: TemplatePlatformReport;
}

interface TemplateManifestFile {
  path: string;
  sha256: string;
  objectKey: string;
  size: number;
}

/** Only the Ceph object keys matter for cleanup; DB rows satisfy this structurally. */
export interface TemplateArtifactRefs {
  coverImage?: string | null;
  manifestObjectKey?: string | null;
}

/** Ceph round trips per template file are the publish bottleneck; bound the fan-out. */
const BLOB_UPLOAD_CONCURRENCY = 8;

/**
 * Publishes a template ZIP to Ceph using the exact starter-v6 layout:
 * content-addressed blobs under `appbuilder/blobs/sha256/<aa>/<sha>` plus a
 * system manifest at `appbuilder/manifests/_system/template_<id>.json`.
 * RuntimeRevisionService resolves the revision id back through that manifest.
 */
@Injectable()
export class ConversationV2TemplatePublishService {
  private readonly logger = new Logger(ConversationV2TemplatePublishService.name);

  constructor(private readonly documents: DocumentService) {}

  async publish(templateId: string, zip: Buffer): Promise<PublishedTemplateRevision> {
    const revisionId = templateRevisionId(templateId);
    const files = extractTemplateArchive(zip);
    const manifestFiles: TemplateManifestFile[] = [];
    const platformReport = await this.analyze(files);

    // Blob uploads dominate publish latency (one exists + one put per file), so
    // they run in bounded parallel batches; order stays ZIP order.
    for (let start = 0; start < files.length; start += BLOB_UPLOAD_CONCURRENCY) {
      const batch = files.slice(start, start + BLOB_UPLOAD_CONCURRENCY);
      const entries = await Promise.all(
        batch.map(async (file): Promise<TemplateManifestFile> => {
          const sha256 = createHash('sha256').update(file.data).digest('hex');
          const objectKey = blobObjectKey(sha256);
          // Blobs are content-addressed and shared across revisions: reuse when present.
          if (!(await this.documents.exists(objectKey))) {
            await this.documents.upload(
              file.data,
              file.path.split('/').pop() || 'file',
              'application/octet-stream',
              {
                generateUniqueName: false,
                customFileName: objectKey,
                // Template ZIPs include arbitrary binaries; MIME whitelist is for user docs.
                skipMimeValidation: true,
              },
            );
          }
          return { path: file.path, sha256, objectKey, size: file.data.length };
        }),
      );
      manifestFiles.push(...entries);
    }

    const manifestObjectKey = templateManifestKey(revisionId);
    const manifest = Buffer.from(
      JSON.stringify({
        revisionId,
        parentRevisionId: null,
        files: manifestFiles,
      }),
      'utf8',
    );
    await this.documents.upload(manifest, `${revisionId}.json`, 'application/json', {
      generateUniqueName: false,
      customFileName: manifestObjectKey,
    });

    this.logger.log(
      `Published template revision templateId=${templateId} revisionId=${revisionId} ` +
        `files=${manifestFiles.length} platform=${platformReport.status}`,
    );

    return {
      revisionId,
      manifestObjectKey,
      manifestHash: createHash('sha256').update(manifest).digest('hex'),
      fileCount: manifestFiles.length,
      files: manifestFiles,
      platformReport,
    };
  }

  /** Runs the Platform Kit baseline against the ZIP contents, before upload. */
  private analyze(
    files: Array<{ path: string; data: Buffer }>,
  ): Promise<TemplatePlatformReport> {
    const byPath = new Map(files.map((file) => [file.path.replace(/\\/g, '/'), file.data]));
    return analyzeTemplatePlatform({
      paths: [...byPath.keys()],
      read: (path) => Promise.resolve(byPath.get(path)?.toString('utf8') ?? null),
    });
  }

  /**
   * Best-effort removal of a template's cover and manifest objects. Shared,
   * content-addressed blobs are intentionally left in place. Never throws:
   * a Ceph hiccup must not fail an already-committed DB delete.
   */
  async removeTemplateArtifacts(templates: TemplateArtifactRefs[]): Promise<void> {
    const keys = [
      ...templates.map((t) => t.coverImage ?? ''),
      ...templates.map((t) => t.manifestObjectKey ?? ''),
    ].filter((key) => key.length > 0);
    if (keys.length === 0) return;
    try {
      await this.documents.deleteMany(keys);
    } catch (error) {
      this.logger.warn(
        `Failed to remove ${keys.length} template artifact(s) from Ceph: ${
          (error as Error)?.message ?? error
        }`,
      );
    }
  }
}
