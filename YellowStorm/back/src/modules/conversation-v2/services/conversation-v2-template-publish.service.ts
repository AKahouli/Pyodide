import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DocumentService } from '@modules/document/document.service';
import { blobObjectKey } from '@modules/app-runtime/utils/blob-object-key';
import {
  templateManifestKey,
  templateRevisionId,
} from '../constants/template-catalog.constants';
import { extractTemplateArchive } from '../utils/template-zip.util';
import type { ConversationV2TemplateRow } from '../persistence/conversation-v2-template.store';
export interface PublishedTemplateRevision {
  revisionId: string;
  manifestObjectKey: string;
  fileCount: number;
}

interface TemplateManifestFile {
  path: string;
  sha256: string;
  objectKey: string;
  size: number;
}

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

    for (const file of files) {
      const sha256 = createHash('sha256').update(file.data).digest('hex');
      const objectKey = blobObjectKey(sha256);
      // Blobs are content-addressed and shared across revisions: reuse when present.
      if (!(await this.documents.exists(objectKey))) {
        await this.documents.upload(
          file.data,
          file.path.split('/').pop() || 'file',
          'text/plain',
          { generateUniqueName: false, customFileName: objectKey },
        );
      }
      manifestFiles.push({ path: file.path, sha256, objectKey, size: file.data.length });
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
      `Published template revision templateId=${templateId} revisionId=${revisionId} files=${manifestFiles.length}`,
    );

    return { revisionId, manifestObjectKey, fileCount: manifestFiles.length };
  }

  /**
   * Best-effort removal of a template's cover and manifest objects. Shared,
   * content-addressed blobs are intentionally left in place. Never throws:
   * a Ceph hiccup must not fail an already-committed DB delete.
   */
  async removeTemplateArtifacts(templates: ConversationV2TemplateRow[]): Promise<void> {
    const keys = [
      ...templates.map((t) => t.coverImage),
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
