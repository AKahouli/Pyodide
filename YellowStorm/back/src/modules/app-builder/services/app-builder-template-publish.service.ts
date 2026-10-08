import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { DocumentService } from '@modules/document/document.service';
import { blobObjectKey } from '@modules/app-runtime/utils/blob-object-key';
import {
  analyzeTemplatePlatform,
  type TemplatePlatformReport,
} from '@modules/app-runtime/platform-kit/platform-template-report';
import {
  templateManifestKey,
  templateRevisionId,
} from '../constants/template-catalog.constants';
import { extractTemplateArchive } from '../utils/template-zip.util';

export interface PublishedTemplateRevision {
  revisionId: string;
  manifestObjectKey: string;
  manifestHash: string;
  fileCount: number;
  /** Manifest file list, also persisted to `app_builder.template_revisions`. */
  files: TemplateManifestFile[];
  /** Compatibility snapshot kept for catalog rows; not exposed by admin analyze APIs. */
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
  /** Extra keys (revision manifests, unreferenced content-addressed blobs). */
  objectKeys?: string[];
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
export class AppBuilderTemplatePublishService {
  private readonly logger = new Logger(AppBuilderTemplatePublishService.name);

  constructor(private readonly documents: DocumentService) {}

  async publish(templateId: string, zip: Buffer): Promise<PublishedTemplateRevision> {
    const revisionId = templateRevisionId(templateId);
    const files = extractTemplateArchive(zip);
    const manifestFiles: TemplateManifestFile[] = [];
    const platformReport = await this.analyze(files);

    // An incompatible template must never reach the market — refuse before Ceph writes.
    if (platformReport.status === 'incompatible') {
      throw new BadRequestException(
        ErrorCode.APP_BUILDER_TEMPLATE_PLATFORM_INCOMPATIBLE,
        `Template is not platform-compatible: ${platformReport.violations.join('; ')}`,
      );
    }

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
            // ZIP directory entries yield an empty basename, which is not a usable name.
            const basename = file.path.split('/').pop() ?? '';
            await this.documents.upload(
              file.data,
              basename || 'file',
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
        `files=${String(manifestFiles.length)} platform=${platformReport.status}`,
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

  /**
   * Best-effort removal of template Ceph objects (cover, manifests, and any
   * caller-supplied blob keys). Never throws: a Ceph hiccup must not fail an
   * already-committed DB delete. Callers must only pass content-addressed
   * blobs that are no longer referenced by other revisions.
   */
  async removeTemplateArtifacts(templates: TemplateArtifactRefs[]): Promise<void> {
    const keys = [
      ...new Set(
        templates.flatMap((t) => [
          t.coverImage ?? '',
          t.manifestObjectKey ?? '',
          ...(t.objectKeys ?? []),
        ]),
      ),
    ].filter((key) => key.length > 0);
    if (keys.length === 0) return;
    try {
      await this.documents.deleteMany(keys);
    } catch (error) {
      this.logger.warn(
        `Failed to remove ${String(keys.length)} template artifact(s) from Ceph: ${describeError(error)}`,
      );
    }
  }

  /** Runs the Platform Kit baseline against the ZIP contents, before upload. */
  private analyze(
    files: { path: string; data: Buffer }[],
  ): Promise<TemplatePlatformReport> {
    const byPath = new Map(files.map((file) => [file.path.replace(/\\/g, '/'), file.data]));
    return analyzeTemplatePlatform({
      paths: [...byPath.keys()],
      read: (path) => Promise.resolve(byPath.get(path)?.toString('utf8') ?? null),
    });
  }
}

/** Anything can be thrown, so fall back to its string form instead of assuming an Error. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
