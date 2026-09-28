import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { WorkyStreamRepository } from '../persistence/worky-stream.repository';
import { WorkyMessageRepository } from '../persistence/worky-message.repository';
import type { WorkyStreamRecord } from '../worky.types';
import { BadRequestException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkyEventService } from './worky-event.service';
import { CreateWorkyMessageDto } from '../dto/create-worky-message.dto';
import { canWriteWorkyStream, getWorkyStreamAccess } from '../worky-stream-access';

@Injectable()
export class WorkyPlanningService {
  constructor(
    private readonly streams: WorkyStreamRepository,
    private readonly messages: WorkyMessageRepository,
    private readonly events: WorkyEventService,
  ) {}

  async appendOwnerMessage(
    userId: string,
    streamId: string,
    dto: CreateWorkyMessageDto,
  ): Promise<{ id: string; content: string; createdAt: string; turnId: string | null }> {
    const stream = await this.loadStream(streamId, userId, true);
    if (stream.status === 'archived') {
      throw new BadRequestException(
        ErrorCode.WORKY_STREAM_PHASE_INVALID,
        "Messages are not accepted in phase 'archived'.",
      );
    }
    const message = await this.messages.create({
      streamId: stream.id,
      role: 'owner',
      content: dto.content,
      turnId: dto.turnId ?? null,
    });
    this.events.emit(userId, streamId, {
      type: 'message.appended',
      emittedAt: Date.now(),
      payload: {
        id: message.id,
        role: 'owner',
        content: dto.content,
        turnId: dto.turnId ?? null,
      },
    });
    return {
      id: message.id,
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
    const stream = await this.loadStream(streamId, userId, true);
    const message = await this.messages.create({
      streamId: stream.id,
      role,
      content,
      origin: 'voice',
    });
    this.events.emit(userId, streamId, {
      type: 'message.appended',
      emittedAt: Date.now(),
      payload: { id: message.id, role, content },
    });
    return { id: message.id };
  }

  async getVoicePrompt(userId: string, streamId: string): Promise<{ prompt: string | null }> {
    const stream = await this.loadStream(streamId, userId);
    return { prompt: stream.voicePrompt };
  }

  async setVoicePrompt(
    userId: string,
    streamId: string,
    prompt: string | null,
  ): Promise<{ prompt: string | null }> {
    const stream = await this.loadStream(streamId, userId, true);
    const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
    const voicePrompt = trimmed || null;
    if (voicePrompt !== stream.voicePrompt) {
      const updated = await this.streams.update(stream.id, { voicePrompt });
      if (!updated) {
        throw new NotFoundException(
          ErrorCode.WORKY_STREAM_NOT_FOUND,
          'Worky stream not found.',
        );
      }
    }
    return { prompt: voicePrompt };
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
    const stream = await this.loadStream(streamId, userId);
    // The newest `limit` messages, oldest first.
    const messages = await this.messages.listRecent(stream.id, limit);
    const externalIds = messages
      .map((message) => message.externalId)
      .filter((value): value is string => value !== null);
    const components = await this.messages.listComponents(stream.id, externalIds);
    const componentsByMessage = new Map<
      string,
      Array<{ id: string; type: string; data: Record<string, unknown> }>
    >();
    for (const component of components) {
      const list = componentsByMessage.get(component.messageExternalId) ?? [];
      list.push({
        id: component.externalId ?? '',
        type: component.type,
        data: component.data,
      });
      componentsByMessage.set(component.messageExternalId, list);
    }
    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      turnId: message.turnId,
      planDeltaRef: message.planDeltaRef,
      createdAt: message.createdAt.toISOString(),
      components:
        message.externalId !== null
          ? componentsByMessage.get(message.externalId) ?? []
          : [],
    }));
  }

  private async loadStream(
    streamId: string,
    userId: string,
    requireWrite = false,
  ): Promise<WorkyStreamRecord> {
    if (!isObjectId(streamId)) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const stream = await this.streams.findById(streamId);
    const allowed = stream && (requireWrite
      ? canWriteWorkyStream(stream, userId)
      : Boolean(getWorkyStreamAccess(stream, userId)));
    if (!stream || !allowed) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    return stream;
  }
}
