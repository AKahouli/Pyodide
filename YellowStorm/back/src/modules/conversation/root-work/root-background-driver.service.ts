import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createGrpcMetadata } from '../../../common/grpc/grpc-security.util';
import { AdkInvocationClient } from '../../../common/grpc/adk-invocation-client';
import { StreamService } from '../services/stream.service';
import { RootBackgroundJob, RootBackgroundJobStore } from '../persistence/postgres/root-background-job.store';
import { RootFollowupService } from './root-followup.service';

@Injectable()
export class RootBackgroundDriverService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RootBackgroundDriverService.name);
  private readonly owner = `background_${randomUUID().replaceAll('-', '')}`;
  private readonly active = new Map<string, { task: Promise<void>; abort: AbortController }>();
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private closing = false;

  constructor(private readonly jobs: RootBackgroundJobStore, private readonly stream: StreamService,
    private readonly config: ConfigService, private readonly followups?: RootFollowupService) {}

  onModuleInit() {
    if (!this.config.get<boolean>('conversation.rootBackgroundEnabled', false)) return;
    this.limits();
    this.timer = setInterval(() => { void this.poll(); }, 1000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    for (const item of this.active.values()) item.abort.abort();
    await Promise.allSettled([...this.active.values()].map((item) => item.task));
  }

  private limits() {
    const global = this.config.get<number>('conversation.rootBackgroundMaxActive', 4);
    const perUser = this.config.get<number>('conversation.rootBackgroundMaxPerUser', 2);
    if (![global, perUser].every((limit) => Number.isSafeInteger(limit) && limit >= 1 && limit <= 30) || perUser > global) {
      throw new Error('Invalid bounded background driver limits');
    }
    return { global, perUser };
  }

  async ready(fanout = false): Promise<boolean> {
    return fanout ? this.stream.rootBackgroundReady(true) : this.stream.rootBackgroundReady();
  }

  private async poll() {
    // Store claims independently bound coordinator ownership and leaf compute.
    if (this.closing || this.polling || this.active.size >= this.limits().global * 2) return;
    this.polling = true;
    try {
      if (!await this.ready()) return;
      if (this.closing) return;
      if (this.followups && await this.stream.rootBackgroundReady(false, true)) await this.followups.reconcile();
      if (this.closing) return;
      const job = await this.jobs.claim(this.owner, 30, this.limits());
      if (!job || this.closing) return;
      const abort = new AbortController();
      const task = this.dispatch(job, abort).finally(() => this.active.delete(job.executionId));
      this.active.set(job.executionId, { task, abort });
    } catch {
      this.logger.warn('Background admission is unavailable; no native task was started');
    } finally { this.polling = false; }
  }

  private async dispatch(job: RootBackgroundJob, abort: AbortController) {
    const grant = { executionId: job.executionId, owner: this.owner, fence: job.fence };
    let refreshing = false;
    const heartbeat = setInterval(() => {
      if (refreshing || abort.signal.aborted) return;
      refreshing = true;
      void this.jobs.heartbeat(grant, 30).then((live) => { if (!live) abort.abort(); }, () => abort.abort())
        .finally(() => { refreshing = false; });
    }, 5000);
    heartbeat.unref();
    try {
      if (!await this.ready() || !await this.jobs.markDispatched(grant)) return;
      const timeoutMs = job.deadline.getTime() - Date.now();
      if (timeoutMs <= 0 || abort.signal.aborted) return;
      const client = this.stream.getChatbotClient();
      const call = client.RunBackgroundInvocation({ protocol_version: 1, execution_id: job.executionId,
        conversation_id: job.conversationId, actor_id: job.actorId, conversation_epoch: job.conversationEpoch,
        owner: this.owner, fence: job.fence, request_digest: job.requestDigest,
        control_database_fingerprint: await this.jobs.controlInstance() }, createGrpcMetadata(this.config));
      await AdkInvocationClient.consume<{ execution_id: string; status: string }>(call, { timeoutMs, signal: abort.signal, onChunk: (chunk) => {
        if (chunk?.execution_id !== job.executionId || !['running', 'completed', 'waiting', 'failed', 'cancelled', 'outcome_unknown'].includes(chunk.status)) {
          throw new Error('Invalid background observer update');
        }
      } });
      // EOF is only an observer outcome. The owned lifecycle endpoint commits
      // native completion; an unacknowledged dispatch remains recoverable.
    } catch {
      this.logger.warn(`Background observer detached execution=${job.executionId}; owned reconciliation remains authoritative`);
    } finally { clearInterval(heartbeat); }
  }
}
