import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { WorkyStream, WorkyStreamDocument } from '../schemas/worky-stream.schema';
import { WorkyPlanningService } from './worky-planning.service';
import { WorkySttService } from './worky-stt.service';

/**
 * Bridges inbound WhatsApp group messages into the Worky planning loop:
 * persists the owner message then starts a planning turn so the Manager
 * replies both in the UI (SSE) and back to the WhatsApp group.
 */
@Injectable()
export class WorkyWhatsAppIngressService {
  constructor(
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @Inject(forwardRef(() => WorkyPlanningService))
    private readonly planning: WorkyPlanningService,
    private readonly stt: WorkySttService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyWhatsAppIngressService.name);
  }

  async ingestMessage(input: {
    streamId: string;
    userId: string;
    content: string;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(input.streamId)) {
      this.logger.warn('Worky WhatsApp ingress dropped: invalid streamId', {
        streamId: input.streamId,
      });
      return;
    }

    const stream = await this.streams.findById(input.streamId).exec();
    if (!stream) {
      this.logger.warn('Worky WhatsApp ingress dropped: stream not found', {
        streamId: input.streamId,
      });
      return;
    }
    if (stream.ownerUserId.toString() !== input.userId) {
      this.logger.warn('Worky WhatsApp ingress dropped: userId mismatch', {
        streamId: input.streamId,
      });
      return;
    }
    if (stream.status === 'archived') {
      this.logger.warn('Worky WhatsApp ingress dropped: stream archived', {
        streamId: input.streamId,
      });
      return;
    }

    const saved = await this.planning.appendOwnerMessage(input.userId, input.streamId, {
      content: input.content,
    });

    this.logger.log('Worky WhatsApp message ingested', {
      streamId: input.streamId,
      messageId: saved.id,
    });

    // Planning service forwards IA replies (text + clarifications) to WhatsApp
    // via ensureWhatsAppDelivery at the end of each turn.
    this.planning.startTurn({
      streamId: input.streamId,
      userId: input.userId,
      content: input.content,
      triggerKind: 'owner_message',
    });
  }

  /**
   * Downloads a WhatsApp voice note, transcribes it via Worky STT, then ingests
   * the transcript as a normal owner text message in the Worky chat.
   */
  async ingestAudioMessage(input: {
    streamId: string;
    userId: string;
    audio: Buffer;
    mimetype: string;
  }): Promise<void> {
    const maxBytes = this.configService.get<number>('worky.sttMaxBytes') ?? 26214400;
    if (input.audio.length > maxBytes) {
      this.logger.warn('Worky WhatsApp voice drop: exceeds STT max size', {
        streamId: input.streamId,
        bytes: input.audio.length,
        maxBytes,
      });
      return;
    }

    let transcript: string;
    try {
      const result = await this.stt.transcribe(input.audio, input.mimetype);
      transcript = result.text.trim();
    } catch (err: unknown) {
      this.logger.warn('Worky WhatsApp voice STT failed', {
        streamId: input.streamId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!transcript) {
      this.logger.warn('Worky WhatsApp voice drop: empty transcription', {
        streamId: input.streamId,
      });
      return;
    }

    this.logger.log('Worky WhatsApp voice transcribed', {
      streamId: input.streamId,
      chars: transcript.length,
    });

    await this.ingestMessage({
      streamId: input.streamId,
      userId: input.userId,
      content: transcript,
    });
  }
}
