import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, ErrorCode } from '../../exceptions';
import { RootBackgroundJobStore } from '../persistence/postgres/root-background-job.store';
import { RootBackgroundEventStore } from '../persistence/postgres/root-background-event.store';
import { RootBackgroundAuthorityDto, RootBackgroundEventsDto, RootBackgroundSettlementDto, RootBackgroundPermitDto } from '../dto/root-background.dto';
import { RootDelegateDefinitionService } from './root-delegate-definition.service';
import { RootTemporaryDefinitionService } from './root-temporary-definition.service';
import { RootResultService } from './root-result.service';
import { RootWorkService } from './root-work.service';
import { executionScopeToWire, type DelegateResultV1 } from './root-work.types';
import { RootFanoutService } from './root-fanout.service';
import { RootFollowupService } from './root-followup.service';
import { RootBackgroundResultPageDto } from '../dto/root-background.dto';

@Injectable()
export class RootBackgroundLifecycleService {
  constructor(private readonly jobs: RootBackgroundJobStore, private readonly events: RootBackgroundEventStore,
    private readonly definitions: RootDelegateDefinitionService, private readonly temporary: RootTemporaryDefinitionService,
    private readonly results: RootResultService, private readonly work: RootWorkService, private readonly fanout: RootFanoutService,
    private readonly followups?: RootFollowupService) {}

  private async owned(executionId: string, request: RootBackgroundAuthorityDto) {
    const grant = { executionId, owner: request.owner, fence: request.fence, nativeOwner: request.nativeOwner };
    const identity = await this.work.getExecution(executionId);
    const owned = identity?.role === 'fanout_driver' ? await this.jobs.getOwnedFanout(grant).then((value) => ({
      ...value, child: value.coordinator, state: (value.coordinator.resultPayload as DelegateResultV1).nativeState!, request: null,
    })) : await this.jobs.getOwnedHydration(grant);
    if (owned.job.requestDigest !== request.requestDigest) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background request binding changed');
    }
    return { ...owned, grant };
  }

  async definition(executionId: string, request: RootBackgroundAuthorityDto) {
    const execution = await this.work.getExecution(executionId);
    if (execution?.role === 'followup') {
      if (!this.followups) throw new Error('Synthesis runtime is unavailable');
      return this.followups.definition(executionId, request);
    }
    if (execution?.role === 'fanout_driver') {
      if (!request.nativeOwner) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out hydration requires native ownership');
      const grant = { executionId, owner: request.owner, fence: request.fence, nativeOwner: request.nativeOwner };
      const owned = await this.jobs.getOwnedFanout(grant);
      if (owned.job.requestDigest !== request.requestDigest) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background request binding changed');
      }
      await this.results.authorizeBackgroundExecution(owned.job.conversationId, executionId, owned.job.actorId);
      const current = await this.jobs.getOwnedFanout(grant);
      const state = current.coordinator.resultPayload as DelegateResultV1;
      const parent = current.parent.resultPayload as DelegateResultV1;
      return { kind: 'fanout_driver' as const, executionId, actorId: current.job.actorId, manifest: current.manifest,
        rootContext: parent.nativeState!.rootContext,
        executionScope: executionScopeToWire({ ...state.nativeState!.scope, expectedFence: String(current.job.fence),
          nativeInvocationId: current.job.nativeInvocationId, deadlineEpochMs: current.job.deadline.getTime(),
          resumeIntent: current.job.nativeInvocationId ? 'resume' : 'start' }),
        inputResponses: current.job.pendingInputResponses, inputResponseDigest: current.job.inputResponseDigest };
    }
    const owned = await this.owned(executionId, request);
    const resolved = owned.child.role === 'temporary_worker' ? await this.temporary.resolveOwned(owned.grant)
      : await this.definitions.resolveOwned(owned.grant);
    return { ...resolved, executionScope: executionScopeToWire(resolved.scope), request: owned.request, actorId: owned.job.actorId,
      inputResponses: owned.job.pendingInputResponses, inputResponseDigest: owned.job.inputResponseDigest };
  }

  async readSynthesisResult(executionId: string, producerId: string, request: RootBackgroundResultPageDto) {
    if (!this.followups) throw new Error('Synthesis runtime is unavailable');
    return this.followups.readResult(executionId, producerId, request);
  }

  async itemDefinition(executionId: string, itemId: string, request: RootBackgroundAuthorityDto) {
    if (!request.nativeOwner) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out hydration requires native ownership');
    }
    const grant = { executionId, producerExecutionId: itemId, owner: request.owner,
      fence: request.fence, nativeOwner: request.nativeOwner };
    const owned = await this.jobs.getOwnedFanoutItem(grant, itemId);
    if (owned.job.requestDigest !== request.requestDigest) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background request binding changed');
    }
    const resolved = owned.role === 'temporary_worker' ? await this.temporary.resolveFanoutItem(grant, itemId)
      : await this.definitions.resolveFanoutItem(grant, itemId);
    // Revalidate after profile hydration before returning a usable native definition.
    await this.jobs.getOwnedFanoutItem(grant, itemId);
    return { ...resolved, kind: 'worker' as const, executionScope: executionScopeToWire(resolved.scope) };
  }

  private async ownedItem(executionId: string, itemId: string, request: RootBackgroundAuthorityDto) {
    if (!request.nativeOwner) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out mutation requires native ownership');
    const grant = { executionId, producerExecutionId: itemId, owner: request.owner, fence: request.fence,
      nativeOwner: request.nativeOwner };
    const owned = await this.jobs.getOwnedFanoutItem(grant, itemId);
    if (owned.job.requestDigest !== request.requestDigest) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background request binding changed');
    }
    return { ...owned, grant };
  }

  async itemPermit(executionId: string, itemId: string, request: RootBackgroundPermitDto) {
    if (request.operation === 'release') {
      // Exact permit ownership can release after Stop; it cannot start work.
      const item = await this.work.getExecution(itemId);
      if (!item?.parentExecutionId || item.resultPayload?.nativeState?.backgroundFanoutItem?.coordinatorExecutionId !== executionId) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out item binding changed');
      }
      return this.fanout.permit(item.parentExecutionId, itemId, { operation: 'release', owner: request.permitOwner });
    }
    const owned = await this.ownedItem(executionId, itemId, request);
    return this.fanout.permit(owned.parent.id, itemId, { operation: 'acquire', owner: request.permitOwner }, owned.grant);
  }

  async itemSettle(executionId: string, itemId: string, request: RootBackgroundSettlementDto) {
    const owned = await this.ownedItem(executionId, itemId, request);
    if (request.status === 'cancelled') {
      if (request.text || request.fullText || request.evidence?.length) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Cancellation cannot publish child output');
      }
      const cancelled = await this.work.completeExecution(itemId, 'cancelled', null, [], owned.grant);
      if (!cancelled) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out cancellation unavailable');
      return cancelled.resultPayload;
    }
    await this.results.authorizeBackgroundExecution(owned.job.conversationId, itemId, owned.job.actorId);
    await this.jobs.getOwnedFanoutItem(owned.grant, itemId);
    const result = await this.definitions.settle(owned.parent.id, itemId, {
      status: request.status, text: request.text, fullText: request.fullText, evidence: request.evidence,
    }, owned.grant);
    if (!result) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out settlement unavailable');
    await this.jobs.getOwnedFanoutItem(owned.grant, itemId);
    return result;
  }

  async ingest(executionId: string, request: RootBackgroundEventsDto) {
    const identity = await this.work.getExecution(executionId);
    if (identity?.role === 'followup' && !this.followups) throw new Error('Synthesis runtime is unavailable');
    const owned = identity?.role === 'followup'
      ? await this.followups!.authorizeOwned(executionId, request) : await this.owned(executionId, request);
    await this.results.authorizeBackgroundExecution(owned.job.conversationId, executionId, owned.job.actorId);
    const acknowledgements = await this.events.append(owned.grant, request.requestDigest, request.events);
    return { events: acknowledgements };
  }

  async settle(executionId: string, request: RootBackgroundSettlementDto) {
    const child = await this.work.getExecution(executionId);
    if (child?.role === 'followup') {
      if (!this.followups) throw new Error('Synthesis runtime is unavailable');
      return this.followups.settle(executionId, request);
    }
    const job = await this.jobs.getJob(executionId);
    if (!job || !child || job.requestDigest !== request.requestDigest || child.parentExecutionId !== job.parentExecutionId) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background settlement identity changed');
    }
    // A repeated acknowledgement returns the committed state, never replaces it.
    if (child.terminalAt) return { executionId, status: child.status, resultRef: executionId };
    const grant = { executionId, owner: request.owner, fence: request.fence, nativeOwner: request.nativeOwner };
    if (request.status === 'cancelled') {
      if (request.text || request.fullText || request.evidence?.length) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Cancellation cannot publish child output');
      }
      const cancelled = await this.work.completeExecution(executionId, 'cancelled', null, [], grant);
      if (!cancelled) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background cancellation is not admitted');
      return { executionId, status: cancelled.status, resultRef: executionId };
    }
    const owned = await this.owned(executionId, request);
    const hasOutput = Boolean(request.text || request.fullText || request.evidence?.length);
    if (hasOutput || request.status === 'completed' || request.status === 'waiting') {
      await this.results.authorizeBackgroundExecution(job.conversationId, executionId, job.actorId);
    }
    if (request.status === 'completed' && !owned.job.nativeInvocationId
      || request.status === 'waiting' && !owned.state.pendingInputs.length) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background native outcome is not correlated');
    }
    if (child.role === 'fanout_driver') {
      if (request.evidence?.length || request.fullText !== undefined && Buffer.byteLength(request.fullText, 'utf8') > 262144) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Coordinator cannot publish worker evidence or unbounded output');
      }
      const current = await this.jobs.getOwnedFanout(grant);
      if (request.status === 'completed') {
        for (const item of current.manifest.items) {
          const producer = await this.work.getExecution(item.executionId);
          if (!producer?.terminalAt || producer.parentExecutionId !== current.parent.id
            || producer.resultPayload?.nativeState?.backgroundFanoutItem?.coordinatorExecutionId !== executionId) {
            throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Coordinator coverage is not terminal');
          }
          await this.results.authorizeBackgroundExecution(job.conversationId, item.executionId, job.actorId);
        }
      }
      const result: DelegateResultV1 = { executionId, producerAgentId: child.rootAgentId ?? '', producerRole: 'fanout_driver',
        status: request.status, text: request.text ?? null, fullText: request.fullText, citationRefs: [], artifactRefs: [], safeError: null };
      const committed = request.status === 'waiting' ? await this.work.recordNativeState(executionId, owned.state, 'waiting', grant)
        : await this.work.completeExecution(executionId, request.status, result, [], grant);
      if (!committed) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Coordinator settlement is stale');
      return { executionId, status: committed.status, resultRef: executionId };
    }
    const result = await this.definitions.settle(job.parentExecutionId, executionId, {
      status: request.status, text: request.text, fullText: request.fullText, evidence: request.evidence,
    }, grant);
    if (!result) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background settlement was not recorded');
    const committed = await this.work.getExecution(executionId);
    if (!committed) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background execution is unavailable');
    return { executionId, status: committed.status, resultRef: executionId };
  }
}
