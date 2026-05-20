import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, FlattenMaps, Model } from 'mongoose';
import {
  ConversationV2Session,
  ConversationV2SessionDocument,
  ConversationV2SessionStatus,
} from '../schemas/conversation-v2-session.schema';
import { ListSessionsDto } from '../dto/list-sessions.dto';

// lean() returns FlattenMaps of the document; we use a minimal shape for mapping
type LeanSession = FlattenMaps<ConversationV2SessionDocument> & { _id: unknown };

export interface PointerSummary {
  sessionId: string;
  title: string;
  status: ConversationV2SessionStatus;
  lastEventAt: string;
  isShared: boolean;
}

@Injectable()
export class ConversationV2SessionService {
  constructor(
    @InjectModel(ConversationV2Session.name)
    private readonly model: Model<ConversationV2SessionDocument>,
  ) {}

  async createForUser(ownerId: string, sessionId: string): Promise<ConversationV2SessionDocument> {
    const now = new Date();
    return this.model
      .findOneAndUpdate(
        { sessionId },
        {
          $setOnInsert: {
            ownerId,
            sessionId,
            title: '',
            status: 'active',
            lastEventAt: now,
            isShared: false,
            shareTokenHash: null,
            deletedAt: null,
          },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec() as unknown as ConversationV2SessionDocument;
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

  async getOne(ownerId: string, sessionId: string): Promise<ConversationV2SessionDocument | null> {
    return this.model
      .findOne({ sessionId, ownerId, deletedAt: null })
      .lean()
      .exec() as unknown as ConversationV2SessionDocument | null;
  }

  async getByShareToken(shareTokenHash: string): Promise<ConversationV2SessionDocument | null> {
    return this.model
      .findOne({ shareTokenHash, isShared: true, deletedAt: null })
      .lean()
      .exec() as unknown as ConversationV2SessionDocument | null;
  }

  async rename(ownerId: string, sessionId: string, title: string) {
    return this.model
      .findOneAndUpdate(
        { sessionId, ownerId, deletedAt: null },
        { $set: { title } },
        { new: true },
      )
      .lean()
      .exec();
  }

  async setShared(
    ownerId: string,
    sessionId: string,
    isShared: boolean,
    shareTokenHash: string | null,
  ) {
    return this.model
      .findOneAndUpdate(
        { sessionId, ownerId, deletedAt: null },
        { $set: { isShared, shareTokenHash } },
        { new: true },
      )
      .lean()
      .exec();
  }

  async softDelete(ownerId: string, sessionId: string) {
    return this.model
      .findOneAndUpdate(
        { sessionId, ownerId, deletedAt: null },
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
      sessionId: doc.sessionId as string,
      title: (doc.title as string | undefined) ?? '',
      status: doc.status as ConversationV2SessionStatus,
      lastEventAt: d.toISOString(),
      isShared: (doc.isShared as boolean | undefined) ?? false,
    };
  };
}
