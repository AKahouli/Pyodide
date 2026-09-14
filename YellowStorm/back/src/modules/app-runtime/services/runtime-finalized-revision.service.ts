import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConversationV2EventStoreService } from '@modules/conversation-v2/services/conversation-v2-event-store.service';
import {
  AppFinalizedRevision,
  AppFinalizedRevisionDocument,
} from '../schemas/app-finalized-revision.schema';

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
    @InjectModel(AppFinalizedRevision.name)
    private readonly model: Model<AppFinalizedRevisionDocument>,
    @Inject(forwardRef(() => ConversationV2EventStoreService))
    private readonly eventStore: ConversationV2EventStoreService,
  ) {}

  async record(input: RecordFinalizedRevisionInput): Promise<void> {
    const finalizedAt = input.finalizedAt ?? new Date();
    try {
      await this.model.updateOne(
        { workspaceId: input.workspaceId, revisionId: input.revisionId },
        {
          $set: {
            title: input.title,
            finalizedAt,
            eventId: input.eventId,
            fileCount: input.fileCount ?? null,
            cephManifestPath: input.cephManifestPath ?? null,
          },
          $setOnInsert: {
            workspaceId: input.workspaceId,
            revisionId: input.revisionId,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number } | null)?.code !== 11000) {
        throw error;
      }
    }
    this.logger.log(
      `Recorded finalized revision workspaceId=${input.workspaceId} revisionId=${input.revisionId}`,
    );
  }

  async listByWorkspace(workspaceId: string): Promise<FinalizedRevisionRecord[]> {
    const rows = await this.model
      .find({ workspaceId })
      .sort({ finalizedAt: -1 })
      .lean()
      .exec();
    return rows.map((row) => ({
      revisionId: row.revisionId,
      title: row.title,
      finalizedAt: row.finalizedAt.toISOString(),
      ...(typeof row.fileCount === 'number' ? { fileCount: row.fileCount } : {}),
    }));
  }

  async resolveLatestFinalized(workspaceId: string): Promise<string | null> {
    const row = await this.model
      .findOne({ workspaceId })
      .sort({ finalizedAt: -1 })
      .select({ revisionId: 1 })
      .lean()
      .exec();
    return row?.revisionId ?? null;
  }

  async summarizeByWorkspaces(
    workspaceIds: string[],
  ): Promise<Map<string, FinalizedRevisionWorkspaceSummary>> {
    const uniqueIds = [...new Set(workspaceIds.filter((id) => id.trim()))];
    if (!uniqueIds.length) return new Map();

    const rows = await this.model
      .aggregate<{
        _id: string;
        latestRevisionId: string;
        latestFinalizedAt: Date;
        versionCount: number;
      }>([
        { $match: { workspaceId: { $in: uniqueIds } } },
        { $sort: { finalizedAt: -1 } },
        {
          $group: {
            _id: '$workspaceId',
            latestRevisionId: { $first: '$revisionId' },
            latestFinalizedAt: { $first: '$finalizedAt' },
            versionCount: { $sum: 1 },
          },
        },
      ])
      .exec();

    return new Map(
      rows.map((row) => [
        row._id,
        {
          latestRevisionId: row.latestRevisionId,
          latestFinalizedAt: row.latestFinalizedAt.toISOString(),
          versionCount: row.versionCount,
        },
      ]),
    );
  }

  async assertFinalized(workspaceId: string, revisionId: string): Promise<void> {
    const found = await this.model
      .findOne({ workspaceId, revisionId })
      .select({ _id: 1 })
      .lean()
      .exec();
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
    const existing = await this.model
      .findOne({ workspaceId })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (existing) return;

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
