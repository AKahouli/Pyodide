import { Injectable } from '@nestjs/common';
import { AppException } from '../../exceptions/exceptions/base.exception';
import { ConflictException, ErrorCode } from '../../exceptions';
import { RootBackgroundJobStore } from '../persistence/postgres/root-background-job.store';
import type { RootContinuationRequest } from '../interfaces/message.interface';
import { RootResultService } from './root-result.service';

@Injectable()
export class RootBackgroundInputService {
  constructor(private readonly jobs: RootBackgroundJobStore, private readonly results: RootResultService) {}

  async submit(conversationId: string, executionId: string, actorId: string, inputs: RootContinuationRequest['inputResponses']) {
    await this.results.authorizeBackgroundExecution(conversationId, executionId, actorId);
    try {
      return await this.jobs.queueInputs(conversationId, executionId, actorId, inputs);
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background input is stale or no longer waiting');
    }
  }
}
