import { createHash, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  PlaybookAssistantOperationKind,
  PlaybookAssistantRequest,
  PlaybookAssistantRequestDocument,
} from '../schemas/playbook-assistant-request.schema';

const REQUEST_RETENTION_MS = 24 * 60 * 60 * 1000;
const LEGACY_DEFAULT_TENANT = 'default';

@Injectable()
export class PlaybookAssistantRequestService {
  constructor(
    @InjectModel(PlaybookAssistantRequest.name)
    private readonly requestModel: Model<PlaybookAssistantRequestDocument>,
  ) {}

  async claimTurn(input: {
    requestId?: string;
    conversationId?: string;
    ownerId: string;
    agentId: string;
    operationKind: PlaybookAssistantOperationKind;
    playbookId?: string;
    expectedDefinitionRevision?: number;
    text: string;
    selectedTaskId?: string;
    executionId?: string;
    attachmentIds?: string[];
    context?: Record<string, unknown>;
  }): Promise<{ request: PlaybookAssistantRequest; replay: boolean }> {
    const requestId = input.requestId?.trim() || randomUUID();
    const conversationId = input.conversationId?.trim() || randomUUID();
    const text = input.text.trim();
    const fingerprintInput = {
      ownerId: input.ownerId,
      agentId: input.agentId,
      conversationId: input.conversationId?.trim() || null,
      operationKind: input.operationKind,
      playbookId: input.playbookId ?? null,
      expectedDefinitionRevision: input.expectedDefinitionRevision ?? null,
      text,
      selectedTaskId: input.selectedTaskId ?? null,
      executionId: input.executionId ?? null,
      attachmentIds: input.attachmentIds ?? [],
      context: input.context ?? null,
    };
    const messageHash = this.createRequestFingerprint(fingerprintInput);
    const legacyMessageHash = this.createRequestFingerprint({
      ...fingerprintInput,
      tenantId: LEGACY_DEFAULT_TENANT,
    });

    if (input.conversationId) {
      const conversation = await this.requestModel.findOne({
        conversationId,
        ownerId: input.ownerId,
        ...(input.playbookId ? { playbookId: input.playbookId } : {}),
      }).lean().exec();
      if (!conversation) {
        throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant conversation not found');
      }
    }

    try {
      const created = await this.requestModel.create({
        requestId,
        ownerId: input.ownerId,
        agentId: input.agentId,
        conversationId,
        correlationId: `playbook-assistant:${randomUUID()}`,
        operationKind: input.operationKind,
        playbookId: input.playbookId ?? null,
        expectedDefinitionRevision: input.expectedDefinitionRevision ?? null,
        contextId: randomUUID(),
        messageHash,
        originalText: text,
        selectedTaskId: input.selectedTaskId ?? null,
        executionId: input.executionId ?? null,
        attachmentIds: input.attachmentIds ?? [],
        answers: [],
        status: 'processing',
        expiresAt: new Date(Date.now() + REQUEST_RETENTION_MS),
      });
      return { request: created.toObject(), replay: false };
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await this.requestModel.findOne({ requestId }).lean().exec();
      if (!existing || ![messageHash, legacyMessageHash].includes(existing.messageHash)) {
        throw new ConflictException(ErrorCode.IDEMPOTENCY_MISMATCH, 'Assistant request ID was reused with different content');
      }
      if (existing.status !== 'completed') {
        throw new ConflictException(ErrorCode.CONFLICT, 'Assistant request is already in progress');
      }
      return { request: existing, replay: true };
    }
  }

  async getBound(requestId: string, actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string }): Promise<PlaybookAssistantRequest> {
    const request = await this.requestModel.findOne({ requestId, ownerId: actor.ownerId }).lean().exec();
    if (!request || request.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant request not found or expired');
    }
    if (request.agentId !== actor.agentId
      || request.conversationId !== actor.conversationId || request.correlationId !== actor.correlationId) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant request actor binding does not match');
    }
    return request;
  }

  async claimGenerationForTurn(input: {
    actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string };
    text: string;
  }): Promise<PlaybookAssistantRequest> {
    const text = input.text.trim();
    const requestId = `platform-generation:${createHash('sha256')
      .update(JSON.stringify(this.canonicalize(input.actor)))
      .digest('hex')}`;
    const legacyRequestId = `platform-generation:${createHash('sha256')
      .update(JSON.stringify(this.canonicalize({ ...input.actor, tenantId: LEGACY_DEFAULT_TENANT })))
      .digest('hex')}`;
    const fingerprintInput = {
      ...input.actor,
      operationKind: 'generation',
      text,
    };
    const messageHash = this.createRequestFingerprint(fingerprintInput);
    const legacyMessageHash = this.createRequestFingerprint({
      ...fingerprintInput,
      tenantId: LEGACY_DEFAULT_TENANT,
    });
    const existingBeforeInsert = await this.requestModel.findOne({
      requestId: { $in: [requestId, legacyRequestId] },
    }).lean().exec();
    if (existingBeforeInsert) {
      return this.assertMatchingCurrentTurnRequest(
        existingBeforeInsert,
        input.actor,
        [messageHash, legacyMessageHash],
      );
    }
    try {
      const created = await this.requestModel.create({
        requestId,
        ...input.actor,
        operationKind: 'generation',
        playbookId: null,
        expectedDefinitionRevision: null,
        contextId: randomUUID(),
        messageHash,
        originalText: text,
        selectedTaskId: null,
        executionId: null,
        attachmentIds: [],
        answers: [],
        status: 'processing',
        expiresAt: new Date(Date.now() + REQUEST_RETENTION_MS),
      });
      return created.toObject();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await this.requestModel.findOne({
        requestId: { $in: [requestId, legacyRequestId] },
      }).lean().exec();
      return this.assertMatchingCurrentTurnRequest(existing, input.actor, [messageHash, legacyMessageHash]);
    }
  }

  async claimCurrentTurnModification(input: {
    actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string };
    playbookId: string;
    expectedDefinitionRevision: number;
    text: string;
  }): Promise<PlaybookAssistantRequest> {
    const text = input.text.trim();
    const requestId = `platform-modification:${createHash('sha256')
      .update(JSON.stringify(this.canonicalize({ ...input.actor, playbookId: input.playbookId })))
      .digest('hex')}`;
    const legacyRequestId = `platform-modification:${createHash('sha256')
      .update(JSON.stringify(this.canonicalize({
        ...input.actor,
        tenantId: LEGACY_DEFAULT_TENANT,
        playbookId: input.playbookId,
      })))
      .digest('hex')}`;
    const fingerprintInput = {
      ...input.actor,
      operationKind: 'existing_construction',
      playbookId: input.playbookId,
      expectedDefinitionRevision: input.expectedDefinitionRevision,
      text,
    };
    const messageHash = this.createRequestFingerprint(fingerprintInput);
    const legacyMessageHash = this.createRequestFingerprint({
      ...fingerprintInput,
      tenantId: LEGACY_DEFAULT_TENANT,
    });
    const existingBeforeInsert = await this.requestModel.findOne({
      requestId: { $in: [requestId, legacyRequestId] },
    }).lean().exec();
    if (existingBeforeInsert) {
      return this.assertMatchingCurrentTurnRequest(
        existingBeforeInsert,
        input.actor,
        [messageHash, legacyMessageHash],
        input.playbookId,
      );
    }
    try {
      const created = await this.requestModel.create({
        requestId,
        ...input.actor,
        operationKind: 'existing_construction',
        playbookId: input.playbookId,
        expectedDefinitionRevision: input.expectedDefinitionRevision,
        contextId: randomUUID(),
        messageHash,
        originalText: text,
        selectedTaskId: null,
        executionId: null,
        attachmentIds: [],
        answers: [],
        status: 'processing',
        expiresAt: new Date(Date.now() + REQUEST_RETENTION_MS),
      });
      return created.toObject();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await this.requestModel.findOne({
        requestId: { $in: [requestId, legacyRequestId] },
      }).lean().exec();
      return this.assertMatchingCurrentTurnRequest(
        existing,
        input.actor,
        [messageHash, legacyMessageHash],
        input.playbookId,
      );
    }
  }

  async rebindCorrelationForContinuation(input: {
    continuationId: string;
    playbookId?: string | null;
    actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string };
  }): Promise<void> {
    const result = await this.requestModel.updateOne(
      {
        continuationId: input.continuationId,
        ...(input.playbookId ? { playbookId: input.playbookId } : {}),
        ownerId: input.actor.ownerId,
        agentId: input.actor.agentId,
        conversationId: input.actor.conversationId,
        status: 'awaiting_clarification',
        expiresAt: { $gt: new Date() },
      },
      { $set: { correlationId: input.actor.correlationId } },
    ).exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant clarification not found or expired');
    }
  }

  async claimAssessment(requestId: string): Promise<number> {
    const claimed = await this.requestModel.findOneAndUpdate(
      { requestId, status: 'processing' },
      { $inc: { assessmentVersion: 1 } },
      { new: true },
    ).lean().exec();
    if (!claimed) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant assessment is not available for processing');
    }
    return claimed.assessmentVersion;
  }

  async saveAssessment(requestId: string, assessmentVersion: number, assessment: Record<string, unknown>): Promise<PlaybookAssistantRequest> {
    const needsClarification = assessment.status === 'needs_clarification';
    const continuationId = needsClarification ? randomUUID() : null;
    const updated = await this.requestModel.findOneAndUpdate(
      { requestId, assessmentVersion, status: 'processing' },
      {
        $set: {
          assessment,
          continuationId,
          status: needsClarification ? 'awaiting_clarification' : 'ready',
          expiresAt: new Date(Date.now() + REQUEST_RETENTION_MS),
        },
      },
      { new: true },
    ).lean().exec();
    if (!updated) throw new ConflictException(ErrorCode.CONFLICT, 'Assistant assessment attempt is stale');
    return updated;
  }

  async getByContinuation(continuationId: string, actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string }): Promise<PlaybookAssistantRequest> {
    const request = await this.requestModel.findOne({
      continuationId,
      ownerId: actor.ownerId,
      status: 'awaiting_clarification',
      expiresAt: { $gt: new Date() },
    }).lean().exec();
    if (!request) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant clarification not found or expired');
    return this.getBound(request.requestId, actor);
  }

  async getContinuationForUser(continuationId: string, ownerId: string, playbookId: string, conversationId: string): Promise<PlaybookAssistantRequest> {
    const request = await this.requestModel.findOne({ continuationId, ownerId, playbookId, conversationId }).lean().exec();
    if (!request || request.expiresAt.getTime() <= Date.now() || request.status !== 'awaiting_clarification') {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant clarification not found or expired');
    }
    return request;
  }

  async claimContinuation(input: {
    requestId: string;
    continuationId: string;
    actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string };
    answers: Record<string, unknown>[];
    assessment: Record<string, unknown>;
  }): Promise<void> {
    const claimed = await this.requestModel.findOneAndUpdate(
      {
        requestId: input.requestId,
        continuationId: input.continuationId,
        status: 'awaiting_clarification',
        ownerId: input.actor.ownerId,
        agentId: input.actor.agentId,
        conversationId: input.actor.conversationId,
        correlationId: input.actor.correlationId,
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          answers: input.answers,
          assessment: input.assessment,
          continuationId: null,
          status: 'ready',
        },
      },
      { new: true },
    ).lean().exec();
    if (!claimed) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant clarification was already continued');
    }
  }

  async restoreContinuation(requestId: string, continuationId: string): Promise<void> {
    await this.requestModel.updateOne(
      { requestId, continuationId: null, status: 'processing', mutationOperationId: null },
      { $set: { continuationId, status: 'awaiting_clarification' } },
    ).exec();
  }

  async claimMutation(requestId: string, operationId: string): Promise<string> {
    const claimed = await this.requestModel.findOneAndUpdate(
      { requestId, mutationOperationId: null, status: { $in: ['processing', 'ready'] } },
      { $set: { mutationOperationId: operationId } },
      { new: true },
    ).lean().exec();
    if (claimed) return operationId;
    const existing = await this.requestModel.findOne({ requestId }).lean().exec();
    if (existing?.mutationOperationId) return existing.mutationOperationId;
    throw new ConflictException(ErrorCode.CONFLICT, 'Assistant request is not ready for construction');
  }

  async complete(requestId: string, answer: string, operationId?: string, responsePayload?: Record<string, unknown>): Promise<void> {
    const current = await this.requestModel.findOne({ requestId }).select({ status: 1 }).lean().exec();
    await this.requestModel.updateOne(
      { requestId },
      {
        $set: {
          status: current?.status === 'awaiting_clarification' ? 'awaiting_clarification' : 'completed',
            assistantAnswer: answer,
            ...(operationId ? { mutationOperationId: operationId } : {}),
            ...(responsePayload ? { responsePayload } : {}),
        },
      },
    ).exec();
  }

  async bindGeneratedPlaybook(requestId: string, playbookId: string, expectedDefinitionRevision: number): Promise<void> {
    await this.requestModel.updateOne(
      { requestId, operationKind: 'generation' },
      { $set: { playbookId, expectedDefinitionRevision } },
    ).exec();
  }

  async resetMutation(requestId: string, operationId: string): Promise<boolean> {
    const result = await this.requestModel.updateOne(
      { requestId, mutationOperationId: operationId },
      { $set: { mutationOperationId: null, playbookId: null, expectedDefinitionRevision: null, status: 'processing' } },
    ).exec();
    return result.modifiedCount === 1;
  }

  async releaseMutation(requestId: string, operationId: string): Promise<void> {
    await this.requestModel.updateOne(
      { requestId, mutationOperationId: operationId },
      { $set: { mutationOperationId: null } },
    ).exec();
  }

  async fail(requestId: string): Promise<void> {
    await this.requestModel.updateOne({ requestId }, { $set: { status: 'failed' } }).exec();
  }

  private createRequestFingerprint(input: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(this.canonicalize(input))).digest('hex');
  }

  private assertMatchingCurrentTurnRequest(
    existing: PlaybookAssistantRequest | null,
    actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string },
    acceptedMessageHashes: string[],
    playbookId?: string,
  ): PlaybookAssistantRequest {
    if (!existing || existing.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant request not found or expired');
    }
    if (!acceptedMessageHashes.includes(existing.messageHash)
      || existing.ownerId !== actor.ownerId
      || existing.agentId !== actor.agentId
      || existing.conversationId !== actor.conversationId
      || existing.correlationId !== actor.correlationId
      || (playbookId !== undefined && existing.playbookId !== playbookId)) {
      throw new ConflictException(ErrorCode.IDEMPOTENCY_MISMATCH, 'Assistant request identity was reused with different content');
    }
    return existing;
  }

  private canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonicalize(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, this.canonicalize(nested)]));
    }
    return value;
  }
}
