import { createHash, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  PlaybookAssistantRequestRepository,
  type PlaybookAssistantOperationKind,
  type PlaybookAssistantRequestRecord,
} from '../persistence/assistant-request.repository';
import type { ResolvedConversationPlaybookHandoffV1 } from '@modules/conversation/interfaces/conversation-playbook-handoff.interface';

const REQUEST_RETENTION_MS = 24 * 60 * 60 * 1000;
const LEGACY_DEFAULT_TENANT = 'default';

@Injectable()
export class PlaybookAssistantRequestService {
  constructor(private readonly requests: PlaybookAssistantRequestRepository) {}

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
  }): Promise<{ request: PlaybookAssistantRequestRecord; replay: boolean }> {
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
      if (!(await this.requests.conversationExists(input.ownerId, conversationId, input.playbookId))) {
        throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant conversation not found');
      }
    }

    const created = await this.requests.insert({
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
      expiresAt: new Date(Date.now() + REQUEST_RETENTION_MS),
    });
    if (created) return { request: created, replay: false };
    // The request id is taken: replay the completed request it identifies, if it is the same one.
    const existing = await this.requests.findByRequestId(requestId);
    if (!existing || ![messageHash, legacyMessageHash].includes(existing.messageHash)) {
      throw new ConflictException(ErrorCode.IDEMPOTENCY_MISMATCH, 'Assistant request ID was reused with different content');
    }
    if (existing.status !== 'completed') {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant request is already in progress');
    }
    return { request: existing, replay: true };
  }

  async getBound(requestId: string, actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string }): Promise<PlaybookAssistantRequestRecord> {
    const request = await this.requests.findByRequestId(requestId, actor.ownerId);
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
    requestedName?: string;
    handoff?: ResolvedConversationPlaybookHandoffV1;
  }): Promise<PlaybookAssistantRequestRecord> {
    const text = input.text.trim();
    const requestedName = input.requestedName?.trim() || null;
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
      requestedName,
      handoffId: input.handoff?.handoffId ?? null,
      handoffVersion: input.handoff?.handoffVersion ?? null,
      contextFingerprint: input.handoff?.contextFingerprint ?? null,
    };
    const messageHash = this.createRequestFingerprint(fingerprintInput);
    const legacyMessageHash = this.createRequestFingerprint({
      ...fingerprintInput,
      tenantId: LEGACY_DEFAULT_TENANT,
    });
    const preNameMessageHash = this.createRequestFingerprint({
      ...input.actor,
      operationKind: 'generation',
      text,
    });
    const legacyPreNameMessageHash = this.createRequestFingerprint({
      ...input.actor,
      tenantId: LEGACY_DEFAULT_TENANT,
      operationKind: 'generation',
      text,
    });
    const acceptedMessageHashes = [
      messageHash,
      legacyMessageHash,
      preNameMessageHash,
      legacyPreNameMessageHash,
    ];
    const existingBeforeInsert = await this.requests.findFirstByRequestIds([requestId, legacyRequestId]);
    if (existingBeforeInsert) {
      return this.assertMatchingCurrentTurnRequest(
        existingBeforeInsert,
        input.actor,
        acceptedMessageHashes,
      );
    }
    const created = await this.requests.insert({
      requestId,
      ...input.actor,
      operationKind: 'generation',
      playbookId: null,
      expectedDefinitionRevision: null,
      contextId: randomUUID(),
      messageHash,
      originalText: text,
      requestedName,
      handoffContext: input.handoff?.context ?? null,
      handoffProvenance: input.handoff ? {
        handoffId: input.handoff.handoffId,
        handoffVersion: input.handoff.handoffVersion,
        sourceConversationId: input.handoff.sourceConversationId,
        targetMessageId: input.handoff.targetMessageId,
        displayedAnswerVersion: input.handoff.displayedAnswerVersion,
        canonicalPathFingerprint: input.handoff.canonicalPathFingerprint,
        contextFingerprint: input.handoff.contextFingerprint,
        acceptedAt: input.handoff.acceptedAt,
      } : null,
      workspaceDefaultIds: input.handoff?.workspaceDefaultIds ?? [],
      selectedTaskId: null,
      executionId: null,
      attachmentIds: [],
      expiresAt: new Date(Date.now() + REQUEST_RETENTION_MS),
    });
    if (created) return created;
    // A concurrent turn inserted it first.
    const existing = await this.requests.findFirstByRequestIds([requestId, legacyRequestId]);
    return this.assertMatchingCurrentTurnRequest(existing, input.actor, acceptedMessageHashes);
  }

  async claimCurrentTurnModification(input: {
    actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string };
    playbookId: string;
    expectedDefinitionRevision: number;
    text: string;
  }): Promise<PlaybookAssistantRequestRecord> {
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
    const existingBeforeInsert = await this.requests.findFirstByRequestIds([requestId, legacyRequestId]);
    if (existingBeforeInsert) {
      return this.assertMatchingCurrentTurnRequest(
        existingBeforeInsert,
        input.actor,
        [messageHash, legacyMessageHash],
        input.playbookId,
      );
    }
    const created = await this.requests.insert({
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
      expiresAt: new Date(Date.now() + REQUEST_RETENTION_MS),
    });
    if (created) return created;
    // A concurrent turn inserted it first.
    const existing = await this.requests.findFirstByRequestIds([requestId, legacyRequestId]);
    return this.assertMatchingCurrentTurnRequest(
      existing,
      input.actor,
      [messageHash, legacyMessageHash],
      input.playbookId,
    );
  }

  async rebindCorrelationForContinuation(input: {
    continuationId: string;
    playbookId?: string | null;
    actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string };
  }): Promise<void> {
    const rebound = await this.requests.rebindCorrelation({
      continuationId: input.continuationId,
      playbookId: input.playbookId,
      ownerId: input.actor.ownerId,
      agentId: input.actor.agentId,
      conversationId: input.actor.conversationId,
    }, input.actor.correlationId);
    if (!rebound) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant clarification not found or expired');
    }
  }

  async claimAssessment(requestId: string): Promise<number> {
    const assessmentVersion = await this.requests.claimAssessment(requestId);
    if (assessmentVersion === null) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant assessment is not available for processing');
    }
    return assessmentVersion;
  }

  async saveAssessment(requestId: string, assessmentVersion: number, assessment: Record<string, unknown>): Promise<PlaybookAssistantRequestRecord> {
    const needsClarification = assessment.status === 'needs_clarification';
    const continuationId = needsClarification ? randomUUID() : null;
    const updated = await this.requests.saveAssessment(requestId, assessmentVersion, {
      assessment,
      continuationId,
      status: needsClarification ? 'awaiting_clarification' : 'ready',
      expiresAt: new Date(Date.now() + REQUEST_RETENTION_MS),
    });
    if (!updated) throw new ConflictException(ErrorCode.CONFLICT, 'Assistant assessment attempt is stale');
    return updated;
  }

  async getByContinuation(continuationId: string, actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string }): Promise<PlaybookAssistantRequestRecord> {
    const request = await this.requests.findAwaitingContinuation(continuationId, actor.ownerId);
    if (!request) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant clarification not found or expired');
    return this.getBound(request.requestId, actor);
  }

  async getContinuationForUser(continuationId: string, ownerId: string, playbookId: string, conversationId: string): Promise<PlaybookAssistantRequestRecord> {
    const request = await this.requests.findContinuation(continuationId, ownerId, playbookId, conversationId);
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
    const claimed = await this.requests.claimContinuation(
      { requestId: input.requestId, continuationId: input.continuationId, ...input.actor },
      { answers: input.answers, assessment: input.assessment },
    );
    if (!claimed) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant clarification was already continued');
    }
  }

  async restoreContinuation(requestId: string, continuationId: string): Promise<void> {
    await this.requests.restoreContinuation(requestId, continuationId);
  }

  async claimMutation(requestId: string, operationId: string): Promise<string> {
    if (await this.requests.claimMutation(requestId, operationId)) return operationId;
    const existing = await this.requests.findByRequestId(requestId);
    if (existing?.mutationOperationId) return existing.mutationOperationId;
    throw new ConflictException(ErrorCode.CONFLICT, 'Assistant request is not ready for construction');
  }

  async complete(requestId: string, answer: string, operationId?: string, responsePayload?: Record<string, unknown>): Promise<void> {
    await this.requests.complete(requestId, answer, operationId, responsePayload);
  }

  async bindGeneratedPlaybook(requestId: string, playbookId: string, expectedDefinitionRevision: number): Promise<void> {
    await this.requests.bindGeneratedPlaybook(requestId, playbookId, expectedDefinitionRevision);
  }

  async resetMutation(requestId: string, operationId: string): Promise<boolean> {
    return this.requests.resetMutation(requestId, operationId);
  }

  async releaseMutation(requestId: string, operationId: string): Promise<void> {
    await this.requests.releaseMutation(requestId, operationId);
  }

  async fail(requestId: string): Promise<void> {
    await this.requests.markFailed(requestId);
  }

  private createRequestFingerprint(input: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(this.canonicalize(input))).digest('hex');
  }

  private assertMatchingCurrentTurnRequest(
    existing: PlaybookAssistantRequestRecord | null,
    actor: { ownerId: string; agentId: string; conversationId: string; correlationId: string },
    acceptedMessageHashes: string[],
    playbookId?: string,
  ): PlaybookAssistantRequestRecord {
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
