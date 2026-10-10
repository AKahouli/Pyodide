import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode, NotFoundException } from '../../exceptions';
import { ConversationService } from '../services/conversation.service';
import { RootBackgroundJobStore } from '../persistence/postgres/root-background-job.store';
import { RootBackgroundEventStore } from '../persistence/postgres/root-background-event.store';
import { RootWorkService } from './root-work.service';
import { RootResultService } from './root-result.service';
import type { RootStopDto, RootJobCancelDto } from '../dto/root-work-public.dto';
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
    const isAccessible = async (executionId: string) => {
      try {
        await this.results.authorizeBackgroundExecution(conversationId, executionId, actorId);
        return true;
      } catch (error) {
        // Historical jobs can lose access after a profile or permission change.
        // Filter that entry without masking operational failures or newer work.
        if (error instanceof NotFoundException) return false;
        throw error;
      }
    };
    const parents = new Map<string, Awaited<ReturnType<RootWorkService['getExecution']>>>();
    const publicJobs = [];
    jobLoop: for (const job of snapshot.jobs) {
      if (!await isAccessible(job.executionId)) continue;
      if (!parents.has(job.parentExecutionId)) parents.set(job.parentExecutionId, await this.work.getExecution(job.parentExecutionId));
      const parent = parents.get(job.parentExecutionId);
      const origin = parent?.resultPayload?.nativeState?.origin;
      const task = ['library_worker', 'temporary_worker'].includes(job.role)
        ? job.nativeState?.admittedRequest?.task : parent?.resultPayload?.nativeState?.requestProfile?.content;
      const fanoutItems = [];
      if (job.role === 'fanout_driver') {
        const binding = job.nativeState?.backgroundFanout;
        const manifest = parent?.resultPayload?.nativeState?.fanoutManifests?.find((item) =>
          item.manifestId === binding?.manifestId && item.digest === binding?.digest);
        for (const item of manifest?.items.slice(0, 50) ?? []) {
          const execution = await this.work.getExecution(item.executionId);
          if (execution) {
            if (!await isAccessible(item.executionId)) continue jobLoop;
            if (execution.resultPayload?.nativeState?.backgroundFanoutItem?.coordinatorExecutionId !== job.executionId) {
              continue jobLoop;
            }
          }
          fanoutItems.push({ executionId: item.executionId, label: item.task.slice(0, 160),
            status: execution?.status ?? (['queued', 'running', 'waiting'].includes(job.status) ? 'queued' : 'not_started') });
        }
      }
      publicJobs.push({ executionId: job.executionId, parentExecutionId: job.parentExecutionId, status: job.status,
        role: job.role, createdAt: job.createdAt, deadline: job.deadline,
        ...(task ? { task: task.slice(0, 240) } : {}),
        ...(origin ? { originAssistantMessageId: origin.assistantMessageId,
          ...(origin.questionMessageId ? { originQuestionMessageId: origin.questionMessageId } : {}) } : {}),
        ...(job.role === 'fanout_driver' ? { fanoutItems } : {}),
        ...(job.nativeState?.followup?.publishedAt ? { publicationMessageId: job.nativeState.followup.publicationMessageId } : {}) });
    }
    const current = await this.creator(conversationId, actorId);
    if ((current.rootWorkEpoch ?? 0) !== snapshot.epoch || current.rootAgentId !== snapshot.rootAgentId) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Root work epoch changed');
    }
    return { epoch: snapshot.epoch, watermark: snapshot.watermark, stopRequestId: newStopRequestId(),
      jobs: publicJobs };
  }

  async replay(conversationId: string, actorId: string, epoch: number, after: string) {
    await this.creator(conversationId, actorId);
    if (!this.config.get<boolean>('conversation.rootBackgroundEnabled', false)) return [];
    return this.events.replay(conversationId, actorId, epoch, after);
  }

  async cancel(conversationId: string, actorId: string, executionId: string, request: RootJobCancelDto) {
    await this.creator(conversationId, actorId);
    if (!this.config.get<boolean>('conversation.rootBackgroundEnabled', false)) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Background task is unavailable');
    }
    await this.results.authorizeBackgroundExecution(conversationId, executionId, actorId);
    return this.jobs.cancel(conversationId, actorId, executionId, request.expectedEpoch);
  }

  async stop(conversationId: string, actorId: string, request: RootStopDto) {
    await this.creator(conversationId, actorId);
    const liveMessageIds = this.stream.getActiveStreamSnapshots(conversationId).map((snapshot) => snapshot.messageId);
    const foregroundMessageId = request.foregroundMessageId ?? liveMessageIds[0];
    if (foregroundMessageId && (await this.messages.findById(foregroundMessageId)).conversationId !== conversationId) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Foreground execution is unavailable');
    }
    const barrier = await this.work.stopRootWork({ conversationId, actorId,
      stopRequestId: request.stopRequestId, expectedEpoch: request.expectedEpoch,
      ...(foregroundMessageId ? { foregroundMessageId } : {}) });
    const durableIds = barrier.foregroundMessageIds ?? (barrier.foregroundMessageId ? [barrier.foregroundMessageId] : []);
    const cancellationMessageIds = [...new Set([...durableIds,
      ...(barrier.applied ? [...liveMessageIds, ...(foregroundMessageId ? [foregroundMessageId] : [])] : [])])];
    const outcomes = await Promise.allSettled(cancellationMessageIds.map((messageId) =>
      this.stream.stopStream(actorId, conversationId, messageId)));
    const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    if (failure) {
        const error: unknown = failure.reason;
        this.logger.warn(`Root Stop barrier committed; foreground cancellation requires reconciliation (${error instanceof Error ? error.name : 'unknown'})`);
        return { ...barrier, foregroundCancellationPending: true };
    }
    // A legacy stream without a durable execution row cannot be safely
    // retargeted on replay. Keep its cancellation outcome explicitly unknown.
    return { ...barrier, foregroundCancellationPending: Boolean(
      !barrier.applied && foregroundMessageId && !barrier.foregroundMessageIds && !barrier.foregroundMessageId) };
  }
}
