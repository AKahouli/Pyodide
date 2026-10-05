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
    const parent = await this.work.getExecution(parentId);
    const actorId = parent?.resultPayload?.nativeState?.actorId;
    const job = await this.jobs.getJob(childId);
    if (!parent || parent.role !== 'root' || parent.depth !== 0 || !actorId || !job
      || job.parentExecutionId !== parentId || job.conversationEpoch !== parent.conversationEpoch) throw denied();
    await this.results.authorizeBackgroundExecution(parent.conversationId, childId, actorId);
    return { executionId: childId, status: job.status, resultRef: childId };
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
