import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConversationV2StreamService } from '@modules/conversation-v2/services/conversation-v2-stream.service';
import type { RuntimeBindingRecord } from '../persistence/runtime-binding.store';
import type { FilesTreeNode } from '@modules/conversation-v2/types/conversation-v2.types';
import { RuntimeFinalizedRevisionService } from './runtime-finalized-revision.service';

function countFileTreeNodes(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const record = node as FilesTreeNode;
  let count = record.type === 'file' ? 1 : 0;
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      count += countFileTreeNodes(child);
    }
  }
  return count;
}

function normalizeFilesTree(node: unknown): FilesTreeNode | null {
  if (!node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  const rawType = String(record.type ?? 'file');
  const type = rawType === 'dir' || rawType === 'directory' ? 'directory' : 'file';
  const children = Array.isArray(record.children)
    ? record.children.map((child) => normalizeFilesTree(child)).filter(Boolean)
    : undefined;
  return {
    name: String(record.name ?? ''),
    type,
    ...(typeof record.path === 'string' ? { path: record.path } : {}),
    ...(typeof record.size === 'number' ? { size: record.size } : {}),
    ...(children?.length ? { children: children as FilesTreeNode[] } : {}),
  };
}

/**
 * Pushes conversation-v2 events when the runtime completes work that OpenCode
 * may not relay over its SSE bus (e.g. application_component after finalize).
 */
@Injectable()
export class AppRuntimeConversationNotifierService {
  private readonly logger = new Logger(AppRuntimeConversationNotifierService.name);

  constructor(
    @Inject(forwardRef(() => ConversationV2StreamService))
    private readonly streamService: ConversationV2StreamService,
    private readonly finalizedRevisions: RuntimeFinalizedRevisionService,
  ) {}

  async notifyFinalize(
    binding: RuntimeBindingRecord,
    args: Record<string, unknown>,
    result: Record<string, unknown>,
  ): Promise<void> {
    const preview = result.preview as { healthy?: boolean } | undefined;
    if (!preview?.healthy) return;

    const revisionId = result.revisionId;
    if (typeof revisionId !== 'string' || !revisionId) return;

    const title = String(args.title ?? 'App').trim() || 'App';
    const cephPath =
      typeof result.cephManifestPath === 'string' ? result.cephManifestPath : undefined;
    const filesTree = normalizeFilesTree(result.fileTree);
    const fileCount = filesTree ? countFileTreeNodes(filesTree) : undefined;
    const eventId = randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);

    await this.finalizedRevisions.record({
      workspaceId: binding.workspaceId,
      revisionId,
      title,
      eventId,
      finalizedAt: new Date(timestamp * 1000),
      fileCount: fileCount ?? null,
      cephManifestPath: cephPath ?? null,
    });

    await this.streamService.publishApplicationComponent(binding.userId, binding.workspaceId, {
      event_id: eventId,
      timestamp,
      url: 'nodepod://preview',
      title,
      ceph_path: cephPath,
      files_tree: filesTree,
      file_count: fileCount,
      revision_id: revisionId,
    });

    this.logger.log(
      `application_component pushed workspaceId=${binding.workspaceId} revisionId=${revisionId}`,
    );
  }
}
