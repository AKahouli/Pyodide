import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ConversationV2Session,
  ConversationV2SessionDocument,
} from '../schemas/conversation-v2-session.schema';
import {
  ConversationV2Event as ConversationV2EventSchemaCls,
  ConversationV2EventDocument,
  ConversationV2EventTypeName,
} from '../schemas/conversation-v2-event.schema';
import type { ConversationV2Event as WireEvent } from '../types/conversation-v2.types';

export interface AppendResult {
  sequence: number;
  inserted: boolean;
}

export interface PersistedEventRow {
  sessionId: string;
  sequence: number;
  eventId: string;
  type: ConversationV2EventTypeName;
  emittedAt: number;
  payload: Record<string, unknown>;
  modelId?: string | null;
}

@Injectable()
export class ConversationV2EventStoreService {
  private readonly logger = new Logger(ConversationV2EventStoreService.name);

  constructor(
    @InjectModel(ConversationV2Session.name)
    private readonly sessions: Model<ConversationV2SessionDocument>,
    @InjectModel(ConversationV2EventSchemaCls.name)
    private readonly events: Model<ConversationV2EventDocument>,
  ) {}

  async append(sessionId: string, event: WireEvent): Promise<AppendResult> {
    // `sessionId` is the Mongo _id hex string of the V2 session pointer.
    // The events table stores it as a plain string in its own `sessionId`
    // column (kept for query simplicity), but the sessions collection is
    // keyed by ObjectId, so the pointer lookup wraps it.
    if (!Types.ObjectId.isValid(sessionId)) {
      throw new NotFoundException(`Invalid session id ${sessionId}`);
    }
    const sessionObjectId = new Types.ObjectId(sessionId);

    const pointer = await this.sessions
      .findOneAndUpdate(
        { _id: sessionObjectId },
        { $inc: { eventSequence: 1, eventCount: 1 } },
        { new: true, projection: { eventSequence: 1 } },
      )
      .lean()
      .exec();

    if (!pointer) {
      // The pointer is created up-front by the controller before any append.
      // If we ever reach here the caller has a bug — throw so it surfaces.
      throw new NotFoundException(`Session pointer ${sessionId} not found`);
    }

    const sequence = (pointer as { eventSequence: number }).eventSequence;
    const payloadWithoutHeader = { ...(event.payload as unknown as Record<string, unknown>) };
    delete payloadWithoutHeader.event_id;
    delete payloadWithoutHeader.timestamp;

    const res = await this.events.updateOne(
      { sessionId, eventId: event.payload.event_id },
      {
        $setOnInsert: {
          sessionId,
          eventId: event.payload.event_id,
          sequence,
          type: event.type,
          emittedAt: event.payload.timestamp,
          payload: payloadWithoutHeader,
        },
      },
      { upsert: true },
    );

    const inserted = (res as { upsertedCount?: number }).upsertedCount === 1;
    if (inserted) {
      return { sequence, inserted };
    }
    // Duplicate eventId: the increment we just did is a wasted slot. Return
    // the existing row's true sequence so callers (and SSE clients) see a
    // consistent view between the wire frame and a later listSince fetch.
    const existing = await this.events
      .findOne({ sessionId, eventId: event.payload.event_id })
      .lean()
      .exec() as { sequence?: number } | null;
    return {
      sequence: existing?.sequence ?? sequence,
      inserted: false,
    };
  }

  async listSince(
    sessionId: string,
    since: number,
    limit: number,
  ): Promise<PersistedEventRow[]> {
    const rows = await this.events
      .find({ sessionId, sequence: { $gt: since } })
      .sort({ sequence: 1 })
      .limit(limit)
      .lean()
      .exec();
    return rows as unknown as PersistedEventRow[];
  }

  async listByType(
    sessionId: string,
    type: ConversationV2EventTypeName,
  ): Promise<PersistedEventRow[]> {
    const rows = await this.events
      .find({ sessionId, type })
      .sort({ sequence: 1 })
      .lean()
      .exec();
    return rows as unknown as PersistedEventRow[];
  }

  async tagModel(sessionId: string, eventId: string, modelId: string): Promise<void> {
    await this.events.updateOne(
      { sessionId, eventId },
      { $set: { modelId } },
    );
  }
}
