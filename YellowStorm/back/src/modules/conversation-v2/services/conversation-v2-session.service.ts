import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, FlattenMaps, Model, Types } from 'mongoose';
import {
  ConversationV2Session,
  ConversationV2SessionDocument,
  ConversationV2SessionStatus,
  ConversationV2DeployStatus,
} from '../schemas/conversation-v2-session.schema';
import { ListSessionsDto } from '../dto/list-sessions.dto';

type LeanSession = FlattenMaps<ConversationV2SessionDocument> & { _id: Types.ObjectId };

export interface PointerSummary {
  sessionId: string;
  title: string;
  status: ConversationV2SessionStatus;
  lastEventAt: string;
  isShared: boolean;
  workspaceIds: string[];
  selectedSkillIds: string[];
  selectedConnectorIds: string[];
}

export interface DeployedAppSummary {
  sessionId: string;
  title: string;
  deployedUrl: string;
  lastDeployedAt: string | null;
  source: 'owned' | 'shared';
  shareId: string | null;
  /** Recipient may open the conversation read-only (shared apps only). */
  canOpenConversation: boolean;
}

@Injectable()
export class ConversationV2SessionService {
  constructor(
    @InjectModel(ConversationV2Session.name)
    private readonly model: Model<ConversationV2SessionDocument>,
  ) {}

  /**
   * Insert an empty pointer (draft) and return it. The returned doc has a
   * fresh _id but no aiSessionId or systemWorkspaceId yet — those are
   * populated by `attachAiSession` after gRPC + workspace creation succeed.
   */
  async createDraft(
    ownerId: string,
    workspaceIds: string[] = [],
  ): Promise<ConversationV2SessionDocument> {
    return this.model.create({
      ownerId,
      aiSessionId: null,
      title: '',
      status: 'active',
      lastEventAt: new Date(),
      isShared: false,
      shareTokenHash: null,
      deletedAt: null,
      deployStatus: 'idle',
      deployedUrl: null,
      deployedAppTitle: null,
      lastDeployedAt: null,
      workspaceIds,
      eventSequence: 0,
      eventCount: 0,
      systemWorkspaceId: null,
    });
  }

  /**
   * Finalize a draft pointer: set the gRPC session id and the system
   * workspace id. Filter requires `aiSessionId: null` so a second writer
   * (e.g. retry) doesn't clobber an already-finalized session.
   */
  async attachAiSession(
    id: Types.ObjectId,
    aiSessionId: string,
    systemWorkspaceId: string,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: id, aiSessionId: null },
      {
        $set: {
          aiSessionId,
          systemWorkspaceId: new Types.ObjectId(systemWorkspaceId),
        },
      },
    );
  }

  /**
   * Hard-delete a draft pointer. Safety: refuses to touch any pointer that
   * isn't still a draft (aiSessionId set OR deletedAt set means it's a real
   * session — `softDelete` is the right path for those).
   */
  async deleteDraft(id: Types.ObjectId): Promise<void> {
    await this.model.deleteOne({
      _id: id,
      aiSessionId: null,
      deletedAt: null,
    });
  }

  /**
   * List the owner's successfully deployed apps (sessions with a live URL),
   * newest deployment first. Powers the App Marketplace page.
   */
  async listDeployedApps(ownerId: string): Promise<DeployedAppSummary[]> {
    const docs = await this.model
      .find({ ownerId, deletedAt: null, deployStatus: 'deployed', deployedUrl: { $ne: null } })
      .sort({ lastDeployedAt: -1 })
      .select('title deployedAppTitle deployedUrl lastDeployedAt')
      .lean()
      .exec();
    return docs.map((doc) => ({
      sessionId: doc._id.toString(),
      title:
        (doc.deployedAppTitle as string | undefined) ??
        (doc.title as string | undefined) ??
        '',
      deployedUrl: doc.deployedUrl as string,
      lastDeployedAt: doc.lastDeployedAt ? new Date(doc.lastDeployedAt).toISOString() : null,
      source: 'owned' as const,
      shareId: null,
      canOpenConversation: true,
    }));
  }

  async list(ownerId: string, dto: ListSessionsDto): Promise<PointerSummary[]> {
    const filter: FilterQuery<ConversationV2SessionDocument> = {
      ownerId,
      deletedAt: null,
    };
    if (dto.cursor) filter.lastEventAt = { $lt: new Date(dto.cursor) };
    if (dto.q) filter.title = { $regex: dto.q, $options: 'i' };

    const docs = await this.model
      .find(filter)
      .sort({ lastEventAt: -1 })
      .limit(dto.limit ?? 20)
      .lean()
      .exec();
    return docs.map(this.toSummary);
  }

  async getOne(ownerId: string, id: string): Promise<ConversationV2SessionDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOne({ _id: new Types.ObjectId(id), ownerId, deletedAt: null })
      .lean()
      .exec() as unknown as ConversationV2SessionDocument | null;
  }

  /** Load a non-deleted session by id regardless of owner (caller must authorize). */
  async getById(id: string): Promise<ConversationV2SessionDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOne({ _id: new Types.ObjectId(id), deletedAt: null })
      .lean()
      .exec() as unknown as ConversationV2SessionDocument | null;
  }

  async getByShareToken(shareTokenHash: string): Promise<ConversationV2SessionDocument | null> {
    return this.model
      .findOne({ shareTokenHash, isShared: true, deletedAt: null })
      .lean()
      .exec() as unknown as ConversationV2SessionDocument | null;
  }

  async rename(ownerId: string, id: string, title: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), ownerId, deletedAt: null },
        { $set: { title } },
        { new: true },
      )
      .lean()
      .exec();
  }

  async setShared(
    ownerId: string,
    id: string,
    isShared: boolean,
    shareTokenHash: string | null,
  ) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), ownerId, deletedAt: null },
        { $set: { isShared, shareTokenHash } },
        { new: true },
      )
      .lean()
      .exec();
  }

  async setDeployState(
    ownerId: string,
    id: string,
    patch: {
      deployStatus?: ConversationV2DeployStatus;
      deployedUrl?: string | null;
      deployedAppTitle?: string | null;
      lastDeployedAt?: Date | null;
    },
  ) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), ownerId, deletedAt: null },
        { $set: patch },
        { new: true },
      )
      .lean()
      .exec();
  }

  /** Remove a deployed app from Marketplace without deleting its conversation. */
  async removeDeployedApp(ownerId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          ownerId,
          deletedAt: null,
          deployStatus: 'deployed',
        },
        {
          $set: {
            deployStatus: 'idle',
            deployedUrl: null,
            deployedAppTitle: null,
            lastDeployedAt: null,
          },
        },
        { new: true },
      )
      .lean()
      .exec();
  }

  /**
   * Persist the skill selection for a session. Called on every message send so
   * the stored set always reflects the latest selection (mirrors v1's
   * conversation-level `selectedSkills`). Re-display only — no access checks.
   */
  async setSelectedSkills(id: string, skillIds: string[]): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.model.updateOne(
      { _id: new Types.ObjectId(id), deletedAt: null },
      { $set: { selectedSkillIds: skillIds } },
    );
  }

  /**
   * Persist the connector selection for a session (mirrors setSelectedSkills),
   * so the UI re-displays the selected connectors on reload. Re-display only.
   */
  async setSelectedConnectors(id: string, connectorIds: string[]): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.model.updateOne(
      { _id: new Types.ObjectId(id), deletedAt: null },
      { $set: { selectedConnectorIds: connectorIds } },
    );
  }

  async softDelete(ownerId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), ownerId, deletedAt: null },
        { $set: { deletedAt: new Date() } },
        { new: true },
      )
      .lean()
      .exec();
  }

  private toSummary = (doc: LeanSession): PointerSummary => {
    const lastEventAt = doc.lastEventAt as Date | string | undefined;
    const d = lastEventAt ? new Date(lastEventAt) : new Date(0);
    return {
      sessionId: doc._id.toString(),
      title: (doc.title as string | undefined) ?? '',
      status: doc.status as ConversationV2SessionStatus,
      lastEventAt: d.toISOString(),
      isShared: (doc.isShared as boolean | undefined) ?? false,
      workspaceIds: (doc.workspaceIds as string[] | undefined) ?? [],
      selectedSkillIds: (doc.selectedSkillIds as string[] | undefined) ?? [],
      selectedConnectorIds: (doc.selectedConnectorIds as string[] | undefined) ?? [],
    };
  };
}
