// back/src/modules/conversation-v2/services/conversation-v2-pointer-writer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ConversationV2Session,
  ConversationV2SessionDocument,
  ConversationV2SessionStatus,
} from '../schemas/conversation-v2-session.schema';
import type { ConversationV2Event } from '../types/conversation-v2.types';

@Injectable()
export class ConversationV2PointerWriterService {
  private readonly logger = new Logger(ConversationV2PointerWriterService.name);

  constructor(
    @InjectModel(ConversationV2Session.name)
    private readonly model: Model<ConversationV2SessionDocument>,
  ) {}

  async apply(sessionId: string, event: ConversationV2Event): Promise<void> {
    try {
      const patch: Record<string, unknown> = { lastEventAt: new Date() };

      if (event.type === 'title') {
        patch.title = (event.payload as { title: string }).title;
      }
      const statusForType: Record<string, ConversationV2SessionStatus | undefined> = {
        done: 'completed',
        wait: 'waiting',
        error: 'error',
      };
      const next = statusForType[event.type];
      if (next) patch.status = next;

      // `sessionId` is the Mongo _id hex of the V2 session pointer; the
      // schema no longer has a `sessionId` field, so filter by _id.
      if (!Types.ObjectId.isValid(sessionId)) return;
      await this.model.updateOne(
        { _id: new Types.ObjectId(sessionId) },
        { $set: patch },
      );
    } catch (err) {
      this.logger.warn(
        `pointer write failed for ${sessionId}: ${(err as Error).message}`,
      );
    }
  }
}
