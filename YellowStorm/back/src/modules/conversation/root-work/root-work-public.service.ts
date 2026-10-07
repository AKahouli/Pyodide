import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode, NotFoundException } from '../../exceptions';
import { ConversationService } from '../services/conversation.service';
import { RootBackgroundJobStore } from '../persistence/postgres/root-background-job.store';
import { RootBackgroundEventStore } from '../persistence/postgres/root-background-event.store';
import { RootWorkService } from './root-work.service';
import { RootResultService } from './root-result.service';
import type { RootStopDto } from '../dto/root-work-public.dto';
import { StreamService } from '../services/stream.service';
import { MessageService } from '../services/message.service';
import { newStopRequestId } from './root-work.types';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RootWorkPublicService {
  private readonly logger = new Logger(RootWorkPublicService.name);
  constructor(private readonly conversations: ConversationService, private readonly work: RootWorkService,
    private readonly jobs: RootBackgroundJobStore, private readonly events: RootBackgroundEventStore,
    private readonly results: RootResultService, private readonly stream: StreamService, private readonly messages: MessageService,
    private readonly config: ConfigService) {}

  private async creator(conversationId: string, actorId: string) {
    const conversation = await this.conversations.getConversationDocument(conversationId);
    if (conversation.createdBy !== actorId || conversation.isArchived || conversation.isGroup) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Root work is unavailable');
    }
    return conversation;
  }

  async snapshot(conversationId: string, actorId: string) {
    const conversation = await this.creator(conversationId, actorId);
    if (!this.config.get<boolean>('conversation.rootBackgroundEnabled', false)) {
      return { epoch: conversation.rootWorkEpoch ?? 0, watermark: '0', stopRequestId: newStopRequestId(), jobs: [] };
    }
    const snapshot = await this.jobs.publicSnapshot(conversationId, actorId);
    for (const job of snapshot.jobs) await this.results.authorizeBackgroundExecution(conversationId, job.executionId, actorId);
    const current = await this.creator(conversationId, actorId);
    if ((current.rootWorkEpoch ?? 0) !== snapshot.epoch || current.rootAgentId !== snapshot.rootAgentId) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Root work epoch changed');
    }
    return { epoch: snapshot.epoch, watermark: snapshot.watermark, stopRequestId: newStopRequestId(),
      jobs: snapshot.jobs.map(({ executionId, parentExecutionId, status, role, createdAt, deadline, nativeState }) =>
        ({ executionId, parentExecutionId, status, role, createdAt, deadline,
          ...(nativeState?.followup?.publishedAt ? { publicationMessageId: nativeState.followup.publicationMessageId } : {}) })) };
  }

  async replay(conversationId: string, actorId: string, epoch: number, after: string) {
    await this.creator(conversationId, actorId);
    if (!this.config.get<boolean>('conversation.rootBackgroundEnabled', false)) return [];
    return this.events.replay(conversationId, actorId, epoch, after);
  }

  async stop(conversationId: string, actorId: string, request: RootStopDto) {
    await this.creator(conversationId, actorId);
    const foregroundMessageId = request.foregroundMessageId ?? this.stream.getActiveStreamSnapshot(conversationId)?.messageId;
    if (foregroundMessageId && (await this.messages.findById(foregroundMessageId)).conversationId !== conversationId) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Foreground execution is unavailable');
    }
    const barrier = await this.work.stopRootWork({ conversationId, actorId,
      stopRequestId: request.stopRequestId, expectedEpoch: request.expectedEpoch,
      ...(foregroundMessageId ? { foregroundMessageId } : {}) });
    const cancellationMessageId = barrier.foregroundMessageId ?? (barrier.applied ? foregroundMessageId : undefined);
    if (cancellationMessageId) {
      try { await this.stream.stopStream(actorId, conversationId, cancellationMessageId); }
      catch (error) {
        this.logger.warn(`Root Stop barrier committed; foreground cancellation requires reconciliation (${error instanceof Error ? error.name : 'unknown'})`);
        return { ...barrier, foregroundCancellationPending: true };
      }
    }
    // A legacy stream without a durable execution row cannot be safely
    // retargeted on replay. Keep its cancellation outcome explicitly unknown.
    return { ...barrier, foregroundCancellationPending: Boolean(
      !barrier.applied && foregroundMessageId && !barrier.foregroundMessageId) };
  }
}
