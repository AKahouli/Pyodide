import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkyStream, WorkyStreamDocument } from '../schemas/worky-stream.schema';
import { WorkyMessage, WorkyMessageDocument } from '../schemas/worky-message.schema';
import {
  WorkyMessageComponent,
  WorkyMessageComponentDocument,
} from '../schemas/worky-message-component.schema';
import { BadRequestException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkyEventService } from './worky-event.service';
import { CreateWorkyMessageDto } from '../dto/create-worky-message.dto';

@Injectable()
export class WorkyPlanningService {
  constructor(
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @InjectModel(WorkyMessage.name)
    private readonly messages: Model<WorkyMessageDocument>,
    @InjectModel(WorkyMessageComponent.name)
    private readonly messageComponents: Model<WorkyMessageComponentDocument>,
    private readonly events: WorkyEventService,
  ) {}

  async appendOwnerMessage(
    userId: string,
    streamId: string,
    dto: CreateWorkyMessageDto,
  ): Promise<{ id: string; content: string; createdAt: string; turnId: string | null }> {
    const stream = await this.loadStream(streamId, userId);
    if (stream.status === 'archived') {
      throw new BadRequestException(
        ErrorCode.WORKY_STREAM_PHASE_INVALID,
        "Messages are not accepted in phase 'archived'.",
      );
    }
    const message = await this.messages.create({
      streamId: stream._id,
      role: 'owner',
      content: dto.content,
      turnId: dto.turnId ?? null,
      planDeltaRef: null,
      emittedAt: new Date(),
    });
    this.events.emit(userId, streamId, {
      type: 'message.appended',
      emittedAt: Date.now(),
      payload: {
        id: (message._id as Types.ObjectId).toString(),
        role: 'owner',
        content: dto.content,
        turnId: dto.turnId ?? null,
      },
    });
    return {
      id: (message._id as Types.ObjectId).toString(),
      content: dto.content,
      createdAt: message.createdAt.toISOString(),
      turnId: dto.turnId ?? null,
    };
  }

  failTurn(userId: string, streamId: string, turnId: string): void {
    this.events.emit(userId, streamId, {
      type: 'stream.terminal',
      emittedAt: Date.now(),
      payload: { error: true, source: 'orchestrator-kickoff', turnId },
    });
  }

  async appendVoiceMessage(
    userId: string,
    streamId: string,
    role: 'owner' | 'manager',
    content: string,
  ): Promise<{ id: string }> {
    const message = await this.messages.create({
      streamId: new Types.ObjectId(streamId),
      role,
      content,
      planDeltaRef: null,
      origin: 'voice',
      emittedAt: new Date(),
    });
    const id = (message._id as Types.ObjectId).toString();
    this.events.emit(userId, streamId, {
      type: 'message.appended',
      emittedAt: Date.now(),
      payload: { id, role, content },
    });
    return { id };
  }

  async getVoicePrompt(userId: string, streamId: string): Promise<{ prompt: string | null }> {
    const stream = await this.loadStream(streamId, userId);
    return { prompt: stream.voicePrompt ?? null };
  }

  async setVoicePrompt(
    userId: string,
    streamId: string,
    prompt: string | null,
  ): Promise<{ prompt: string | null }> {
    const stream = await this.loadStream(streamId, userId);
    const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
    stream.voicePrompt = trimmed || null;
    await stream.save();
    return { prompt: stream.voicePrompt };
  }

  async listMessages(
    userId: string,
    streamId: string,
    limit = 200,
  ): Promise<
    Array<{
      id: string;
      role: string;
      content: string;
      turnId: string | null;
      planDeltaRef: string | null;
      createdAt: string;
      components: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    }>
  > {
    await this.loadStream(streamId, userId);
    const streamObjectId = new Types.ObjectId(streamId);
    const docs = await this.messages
      .find({ streamId: streamObjectId })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean()
      .exec();
    const externalIds = docs
      .map((message) => message.externalId)
      .filter((value): value is string => typeof value === 'string');
    const componentDocs = externalIds.length
      ? await this.messageComponents
          .find({ streamId: streamObjectId, messageExternalId: { $in: externalIds } })
          .sort({ ordinal: 1 })
          .lean()
          .exec()
      : [];
    const componentsByMessage = new Map<
      string,
      Array<{ id: string; type: string; data: Record<string, unknown> }>
    >();
    for (const component of componentDocs) {
      const key = component.messageExternalId as string;
      const components = componentsByMessage.get(key) ?? [];
      components.push({
        id: (component.externalId as string) ?? '',
        type: component.type as string,
        data: (component.data as Record<string, unknown>) ?? {},
      });
      componentsByMessage.set(key, components);
    }
    return docs.map((message) => ({
      id: (message._id as Types.ObjectId).toString(),
      role: message.role as string,
      content: message.content as string,
      turnId: typeof message.turnId === 'string' ? message.turnId : null,
      planDeltaRef: message.planDeltaRef
        ? (message.planDeltaRef as Types.ObjectId).toString()
        : null,
      createdAt: (message.createdAt as Date).toISOString(),
      components:
        typeof message.externalId === 'string'
          ? componentsByMessage.get(message.externalId) ?? []
          : [],
    }));
  }

  private async loadStream(streamId: string, userId: string): Promise<WorkyStreamDocument> {
    if (!Types.ObjectId.isValid(streamId)) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const stream = await this.streams.findById(streamId).exec();
    if (!stream || stream.ownerUserId.toString() !== userId) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    return stream;
  }
}
