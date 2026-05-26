import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, FlattenMaps, Model, Types } from 'mongoose';
import {
  ConversationV2Session,
  ConversationV2SessionDocument,
  ConversationV2SessionStatus,
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
    };
  };
}
