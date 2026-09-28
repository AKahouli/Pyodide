import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { ConversationV2EventStoreService } from '@modules/conversation-v2/services/conversation-v2-event-store.service';
import { PgRuntimeFinalizedRevisionStore } from '../persistence/pg-runtime-finalized-revision.store';

export interface FinalizedRevisionRecord {
  revisionId: string;
  title: string;
  finalizedAt: string;
  fileCount?: number;
}

export interface FinalizedRevisionWorkspaceSummary {
  latestRevisionId: string;
  latestFinalizedAt: string;
  versionCount: number;
}

export interface RecordFinalizedRevisionInput {
  workspaceId: string;
  revisionId: string;
  title: string;
  eventId: string;
  finalizedAt?: Date;
  fileCount?: number | null;
  cephManifestPath?: string | null;
}

@Injectable()
export class RuntimeFinalizedRevisionService {
  private readonly logger = new Logger(RuntimeFinalizedRevisionService.name);

  constructor(
    private readonly store: PgRuntimeFinalizedRevisionStore,
    @Inject(forwardRef(() => ConversationV2EventStoreService))
    private readonly eventStore: ConversationV2EventStoreService,
  ) {}

  async record(input: RecordFinalizedRevisionInput): Promise<void> {
    const finalizedAt = input.finalizedAt ?? new Date();
    await this.store.upsert({
      workspaceId: input.workspaceId,
      revisionId: input.revisionId,
      title: input.title,
      finalizedAt,
      eventId: input.eventId,
      fileCount: input.fileCount ?? null,
      cephManifestPath: input.cephManifestPath ?? null,
    });
    this.logger.log(
      `Recorded finalized revision workspaceId=${input.workspaceId} revisionId=${input.revisionId}`,
    );
  }

  async listByWorkspace(workspaceId: string): Promise<FinalizedRevisionRecord[]> {
    const rows = await this.store.listByWorkspace(workspaceId);
    return rows.map((row) => ({
      revisionId: row.revisionId,
      title: row.title,
      finalizedAt: row.finalizedAt.toISOString(),
      ...(typeof row.fileCount === 'number' ? { fileCount: row.fileCount } : {}),
    }));
  }

  async resolveLatestFinalized(workspaceId: string): Promise<string | null> {
    return this.store.resolveLatestFinalized(workspaceId);
  }

  async summarizeByWorkspaces(
    workspaceIds: string[],
  ): Promise<Map<string, FinalizedRevisionWorkspaceSummary>> {
    return this.store.summarizeByWorkspaces(workspaceIds);
  }

  async assertFinalized(workspaceId: string, revisionId: string): Promise<void> {
    const found = await this.store.existsByWorkspaceAndRevision(workspaceId, revisionId);
    if (!found) {
      throw new BadRequestException(
        `Revision ${revisionId} is not a finalized version for this app`,
      );
    }
  }

  /**
   * Lazy backfill from persisted application_component events when no finalized
   * rows exist yet for this workspace (sessions finalized before this feature).
   */
  async backfillFromEvents(
    sessionPointerId: string,
    workspaceId: string,
  ): Promise<void> {
    const existing = await this.store.existsByWorkspaceAndRevision(workspaceId, '');
    // existsByWorkspaceAndRevision with '' won't match; use listByWorkspace instead.
    const list = await this.store.listByWorkspace(workspaceId);
    if (list.length > 0) return;

    const rows = await this.eventStore.listByType(
      sessionPointerId,
      'application_component',
    );

    for (const row of rows) {
      const revisionId = row.payload.revision_id;
      if (typeof revisionId !== 'string' || !revisionId.trim()) continue;

      const title =
        typeof row.payload.title === 'string' && row.payload.title.trim()
          ? row.payload.title.trim()
          : 'App';
      const fileCount =
        typeof row.payload.file_count === 'number' ? row.payload.file_count : null;
      const cephManifestPath =
        typeof row.payload.ceph_path === 'string' ? row.payload.ceph_path : null;

      await this.record({
        workspaceId,
        revisionId: revisionId.trim(),
        title,
        eventId: row.eventId,
        finalizedAt: new Date(row.emittedAt * 1000),
        fileCount,
        cephManifestPath,
      });
    }

    if (rows.length > 0) {
      this.logger.log(
        `Backfilled finalized revisions workspaceId=${workspaceId} from ${rows.length} application_component events`,
      );
    }
  }
}
