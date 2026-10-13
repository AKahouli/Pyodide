import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConversationRootResolverService } from './conversation-root-resolver.service';
import { stableStringify } from '../../agent/services/agent-execution-snapshot.service';
import { ConflictException, ErrorCode } from '../../exceptions';
import { RootBackgroundJobStore } from '../persistence/postgres/root-background-job.store';
import { RootBackgroundSubmissionDto } from '../dto/root-background-submission.dto';
import { RootBackgroundDriverService } from './root-background-driver.service';
import { RootDelegateDefinitionService } from './root-delegate-definition.service';
import { RootTemporaryDefinitionService } from './root-temporary-definition.service';
import { RootResultService } from './root-result.service';
import { RootWorkService } from './root-work.service';
import { RootFanoutService } from './root-fanout.service';
import type { RootBackgroundFanoutDto } from '../dto/root-background.dto';

@Injectable()
export class RootBackgroundSubmissionService {
  constructor(private readonly work: RootWorkService, private readonly jobs: RootBackgroundJobStore,
    private readonly driver: RootBackgroundDriverService, private readonly resolver: ConversationRootResolverService,
    private readonly definitions: RootDelegateDefinitionService, private readonly temporary: RootTemporaryDefinitionService,
    private readonly results: RootResultService, private readonly fanout: RootFanoutService) {}

  async submitFanout(parentId: string, proposal: RootBackgroundFanoutDto) {
    if (!await this.driver.ready(true)) throw denied();
    const manifest = await this.fanout.authorizeBackground(parentId, proposal);
    const job = await this.jobs.admitFanout(parentId, proposal);
    if (job.requestDigest !== manifest.digest) throw denied();
    await this.results.authorizeBackgroundExecution(job.conversationId, job.executionId, job.actorId);
    return { executionId: job.executionId, status: job.status, resultRef: job.executionId };
  }

  async status(parentId: string, childId: string) {
    const { parent, actorId, job } = await this.inspect(parentId, childId);
    await this.results.authorizeBackgroundExecution(parent.conversationId, childId, actorId);
    return { executionId: childId, status: job!.status, resultRef: childId };
  }

  private async inspect(parentId: string, childId?: string) {
    const parent = await this.work.getExecution(parentId);
    const actorId = parent?.resultPayload?.nativeState?.actorId;
    if (!parent || parent.role !== 'root' || parent.depth !== 0 || !actorId || !parent.rootAgentId
      || !['running', 'waiting'].includes(parent.status)
      || parent.resultPayload?.nativeState?.rootContext.background_enabled !== true) throw denied();
    const pool = await this.resolver.resolveForActor(parent.rootAgentId, actorId, parent.conversationId,
      parent.resultPayload?.nativeState?.rootContext.governance_revision ?? null);
    if (!pool.policy.background.enabled || pool.rootSnapshotDigest !== parent.resultPayload?.nativeState?.scope.immutableSnapshotRef) throw denied();
    const job = childId ? await this.jobs.getJob(childId) : null;
    if (childId && (!job || job.conversationId !== parent.conversationId || job.actorId !== actorId
      || job.conversationEpoch !== parent.conversationEpoch)) throw denied();
    return { parent, actorId, job };
  }

  async list(parentId: string) {
    const { parent, actorId } = await this.inspect(parentId);
    const snapshot = await this.jobs.publicSnapshot(parent.conversationId, actorId);
    if (snapshot.epoch !== parent.conversationEpoch || snapshot.rootAgentId !== parent.rootAgentId) throw denied();
    const jobs = snapshot.jobs.slice(0, 20);
    for (const job of jobs) await this.results.authorizeBackgroundExecution(parent.conversationId, job.executionId, actorId);
    await this.inspect(parentId);
    return { jobs: jobs.map(({ executionId, status, role, nativeState }) => ({ executionId, status, role,
      task: ['library_worker', 'temporary_worker'].includes(role) ? nativeState?.admittedRequest?.task?.slice(0, 240) ?? '' : '' })) };
  }

  async result(parentId: string, childId: string, offset: number) {
    const { parent, actorId } = await this.inspect(parentId, childId);
    const result = await this.results.getResult(parent.conversationId, childId, actorId);
    await this.inspect(parentId, childId);
    return { executionId: childId, text: result.text.slice(offset, offset + 8000),
      nextOffset: offset + 8000 < result.text.length ? offset + 8000 : null };
  }

  async cancel(parentId: string, childId: string) {
    const { parent, actorId } = await this.inspect(parentId, childId);
    await this.results.authorizeBackgroundExecution(parent.conversationId, childId, actorId);
    return this.jobs.cancel(parent.conversationId, actorId, childId, parent.conversationEpoch);
  }

  async submit(parentId: string, request: RootBackgroundSubmissionDto) {
    const parent = await this.work.getExecution(parentId);
    const state = parent?.resultPayload?.nativeState;
    if (!parent || !state || parent.role !== 'root' || parent.depth !== 0 || !parent.rootAgentId
      || state.rootContext.background_enabled !== true || !await this.driver.ready()
      || request.workerKind === 'specialist' && !request.agentId
      || request.workerKind === 'temporary' && request.agentId !== undefined) throw denied();
    const pool = await this.resolver.resolveForActor(parent.rootAgentId, state.actorId, parent.conversationId, state.rootContext?.governance_revision ?? null);
    if (!pool.policy.background.enabled || pool.rootSnapshotDigest !== state.scope.immutableSnapshotRef) throw denied();
    const { workerKind, agentId, ...temporaryRequest } = request;
    const admitted = { ...temporaryRequest, expectedOutput: request.expectedOutput ?? '', contextRefs: request.contextRefs ?? [],
      ...(workerKind === 'specialist' ? { agentId } : {}) };
    const childId = createHash('sha256').update(`${parentId}:${request.nativeCallBranch}`).digest('hex').slice(0, 24);
    const existing = await this.jobs.getJob(childId);
    if (existing) {
      const child = await this.results.authorizeBackgroundExecution(parent.conversationId, childId, state.actorId);
      if (existing.parentExecutionId !== parentId || existing.conversationEpoch !== parent.conversationEpoch
        || stableStringify(child.resultPayload?.nativeState?.admittedRequest) !== stableStringify(admitted)) throw denied();
      return { executionId: childId, status: existing.status, resultRef: childId };
    }
    if (!['running', 'waiting'].includes(parent.status)) throw denied();
    const resolved = workerKind === 'temporary' ? await this.temporary.prepareBackground(parentId, temporaryRequest)
      : await this.definitions.prepareBackground(parentId, { ...temporaryRequest, agentId: agentId! });
    if (resolved.executionId !== childId || !('registration' in resolved) || !resolved.registration) throw denied();
    const digest = resolved.registration.nativeState?.rootContext.delegate_request_digest;
    if (typeof digest !== 'string') throw denied();
    const job = await this.jobs.admit(resolved.registration, digest);
    return { executionId: childId, status: job.status, resultRef: childId };
  }
}

const denied = () => new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background work is not currently authorized');
