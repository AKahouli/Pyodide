import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, ErrorCode } from '../../exceptions';
import { RootBackgroundJobStore } from '../persistence/postgres/root-background-job.store';
import { RootBackgroundEventStore } from '../persistence/postgres/root-background-event.store';
import { RootBackgroundAuthorityDto, RootBackgroundEventsDto, RootBackgroundSettlementDto } from '../dto/root-background.dto';
import { RootDelegateDefinitionService } from './root-delegate-definition.service';
import { RootTemporaryDefinitionService } from './root-temporary-definition.service';
import { RootResultService } from './root-result.service';
import { RootWorkService } from './root-work.service';
import { executionScopeToWire } from './root-work.types';

@Injectable()
export class RootBackgroundLifecycleService {
  constructor(private readonly jobs: RootBackgroundJobStore, private readonly events: RootBackgroundEventStore,
    private readonly definitions: RootDelegateDefinitionService, private readonly temporary: RootTemporaryDefinitionService,
    private readonly results: RootResultService, private readonly work: RootWorkService) {}

  private async owned(executionId: string, request: RootBackgroundAuthorityDto) {
    const grant = { executionId, owner: request.owner, fence: request.fence, nativeOwner: request.nativeOwner };
    const owned = await this.jobs.getOwnedHydration(grant);
    if (owned.job.requestDigest !== request.requestDigest) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background request binding changed');
    }
    return { ...owned, grant };
  }

  async definition(executionId: string, request: RootBackgroundAuthorityDto) {
    const owned = await this.owned(executionId, request);
    const resolved = owned.child.role === 'temporary_worker' ? await this.temporary.resolveOwned(owned.grant)
      : await this.definitions.resolveOwned(owned.grant);
    return { ...resolved, executionScope: executionScopeToWire(resolved.scope), request: owned.request, actorId: owned.job.actorId,
      inputResponses: owned.job.pendingInputResponses, inputResponseDigest: owned.job.inputResponseDigest };
  }

  async ingest(executionId: string, request: RootBackgroundEventsDto) {
    const owned = await this.owned(executionId, request);
    await this.results.authorizeBackgroundExecution(owned.job.conversationId, executionId, owned.job.actorId);
    const acknowledgements = await this.events.append(owned.grant, request.requestDigest, request.events);
    return { events: acknowledgements };
  }

  async settle(executionId: string, request: RootBackgroundSettlementDto) {
    const job = await this.jobs.getJob(executionId);
    const child = await this.work.getExecution(executionId);
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
    const result = await this.definitions.settle(job.parentExecutionId, executionId, {
      status: request.status, text: request.text, fullText: request.fullText, evidence: request.evidence,
    }, grant);
    if (!result) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background settlement was not recorded');
    const committed = await this.work.getExecution(executionId);
    if (!committed) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background execution is unavailable');
    return { executionId, status: committed.status, resultRef: executionId };
  }
}
