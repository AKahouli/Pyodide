import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus,  Injectable } from '@nestjs/common';
import {
  AppException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { ConversationService } from './conversation.service';
import { ConversationBranchService } from './conversation-branch.service';
import { ConversationPlaybookContextProjectorService } from './conversation-playbook-context-projector.service';
import type { PreparePlaybookHandoffDto } from '../dto/prepare-playbook-handoff.dto';
import type {
  ConversationPlaybookPreviewV1,
  ResolvedConversationPlaybookHandoffV1,
} from '../interfaces/conversation-playbook-handoff.interface';
import {
  type ConversationPlaybookHandoffRecord,  
} from '../persistence/conversation-playbook-handoff-store';
import { newOwnedId } from '../persistence/owned-id';
import { PostgresConversationPlaybookHandoffStore } from '../persistence/postgres/postgres-conversation-playbook-handoff-store';

const HANDOFF_RETENTION_MS = 24 * 60 * 60 * 1000;
const SUGGESTED_PROMPT = `Create a reusable Yellowmind Playbook that achieves the business goal from this conversation.

Define one workflow node per meaningful business capability, decision, review, or outcome—not per technical tool or API call. Group related tool calls that support the same business step. Treat connectors, tools, agents, and raw action names as implementation details within the appropriate business node.

Generalize organization names, dates, reporting periods, and other one-off values into inputs. Preserve business rules, required resources, approvals, validation, and expected outputs. Ask for clarification when a required binding or business decision is ambiguous.

Do not copy the answer as a fixed result; create the reusable process that can produce an equivalent outcome for new inputs.`;

@Injectable()
export class ConversationPlaybookHandoffService {
  constructor(
    private readonly handoffStore: PostgresConversationPlaybookHandoffStore,
    private readonly branchService: ConversationBranchService,
    private readonly projector: ConversationPlaybookContextProjectorService,
    private readonly conversationService: ConversationService,
  ) {}

  async prepare(
    sourceConversationId: string,
    ownerId: string,
    dto: PreparePlaybookHandoffDto,
  ): Promise<{
    contractVersion: 1;
    status: 'prepared';
    handoffId: string;
    platformConversationId: string;
    suggestedPrompt: string;
    expiresAt: string;
    preview: ConversationPlaybookPreviewV1;
    provenance: {
      sourceConversationId: string;
      targetMessageId: string;
      displayedAnswerVersion: string;
      canonicalPathFingerprint: string;
      contextFingerprint: string;
    };
  }> {
    const requestFingerprint = this.hash({
      contractVersion: dto.contractVersion,
      sourceConversationId,
      targetMessageId: dto.targetMessageId,
      displayedAnswerVersion: dto.displayedAnswerVersion,
      activeBranches: Object.entries(dto.activeBranches).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
      branchSelectionFingerprint: dto.branchSelectionFingerprint,
    });
    const existing = await this.handoffStore.findByCreationRequest(ownerId, dto.creationRequestId);
    if (existing) return this.replayPrepared(existing, requestFingerprint);

    const expectedBranchFingerprint = this.hash({
      contractVersion: 1,
      targetMessageId: dto.targetMessageId,
      displayedAnswerVersion: dto.displayedAnswerVersion,
      activeBranches: Object.entries(dto.activeBranches).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    });
    if (expectedBranchFingerprint !== dto.branchSelectionFingerprint) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Branch selection fingerprint does not match the request',
      );
    }
    const canonical = await this.branchService.resolveCanonicalPath(
      sourceConversationId,
      ownerId,
      dto.targetMessageId,
      dto.activeBranches,
    );
    const target = canonical.messages.find(
      (message) => message.id === dto.targetMessageId,
    );
    if (!target) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    const answer = this.projector.resolveDisplayedAnswer(target, dto.displayedAnswerVersion);
    const projected = this.projector.project(
      canonical.path.map((message) =>
        message.id === dto.targetMessageId
          ? { ...message, components: answer.components }
          : message,
      ),
      answer,
    );
    const contextFingerprint = this.hash(projected.context);
    const handoffId = randomUUID();
    const platformConversation = await this.conversationService.create(ownerId, {
      runtimePurpose: 'platform_copilot',
      creationRequestId: `playbook-handoff:${dto.creationRequestId}`,
    });
    const expiresAt = new Date(Date.now() + HANDOFF_RETENTION_MS);
    const sourceWorkspaceIds = (canonical.source.workspaces ?? []).map(
      (id: { toString(): string }) => id.toString(),
    );
    const created = await this.handoffStore.createPrepared({
      id: newOwnedId(),
      contractVersion: 1,
      handoffId,
      ownerId,
      sourceConversationId,
      targetMessageId: dto.targetMessageId,
      displayedAnswerVersion: dto.displayedAnswerVersion,
      creationRequestId: dto.creationRequestId,
      creationRequestFingerprint: requestFingerprint,
      clientBranchSelectionFingerprint: dto.branchSelectionFingerprint,
      canonicalPathFingerprint: canonical.fingerprint,
      contextFingerprint,
      canonicalSelectedAnswerIds: canonical.selectedAnswerIds,
      platformConversationId: platformConversation.id,
      context: projected.context,
      candidateBindings: {
        workspaceIds: sourceWorkspaceIds,
        documentIds: [],
        connectorIds: [],
        agentIds: [],
        skillIds: [],
      },
      defaultWorkspaceIds: sourceWorkspaceIds.length === 1 ? sourceWorkspaceIds : [],
      preparedAt: new Date(),
      expiresAt,
    });
    return created.created
      ? this.toPrepared(created.record, projected.preview)
      : this.replayPrepared(created.record, requestFingerprint);
  }

  async bind(input: {
    handoffId: string;
    ownerId: string;
    platformConversationId: string;
    turnRequestId: string;
    prompt: string;
  }): Promise<void> {
    const promptHash = this.hash(input.prompt.trim());
    const now = new Date();
    const bound = await this.handoffStore.tryBindPrepared({ ...input, promptHash, boundAt: now });
    if (bound) return;
    const existing = await this.handoffStore.findOwned(input.handoffId, input.ownerId);
    if (!existing || existing.platformConversationId !== input.platformConversationId) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Playbook handoff not found');
    }
    if (existing.expiresAt.getTime() <= Date.now()) throw this.expired();
    if (
      existing.boundTurnRequestId === input.turnRequestId &&
      existing.boundPromptHash === promptHash
    )
      return;
    throw new ConflictException(
      ErrorCode.IDEMPOTENCY_MISMATCH,
      'Playbook handoff is already bound to another turn',
    );
  }

  async attachUserMessage(
    handoffId: string,
    ownerId: string,
    userMessageId: string,
  ): Promise<void> {
    await this.handoffStore.attachUserMessageIfBound(handoffId, ownerId, userMessageId);
  }

  async consume(input: {
    handoffId: string;
    ownerId: string;
    platformConversationId: string;
    turnRequestId: string;
    userMessageId: string;
  }): Promise<ResolvedConversationPlaybookHandoffV1> {
    const handoff = await this.handoffStore.findForConsumption(input);
    if (!handoff)
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Playbook handoff turn binding does not match',
      );
    if (handoff.status === 'bound') {
      await this.handoffStore.markConsumedIfBound(handoff.id, new Date());
    }
    return {
      handoffId: handoff.handoffId,
      handoffVersion: 1,
      sourceConversationId: handoff.sourceConversationId,
      targetMessageId: handoff.targetMessageId,
      displayedAnswerVersion: handoff.displayedAnswerVersion,
      canonicalPathFingerprint: handoff.canonicalPathFingerprint,
      contextFingerprint: handoff.contextFingerprint,
      context: handoff.context,
      workspaceDefaultIds: handoff.defaultWorkspaceIds,
      acceptedAt: (handoff.consumedAt ?? new Date()).toISOString(),
    };
  }

  private replayPrepared(existing: ConversationPlaybookHandoffRecord, fingerprint: string) {
    if (existing.creationRequestFingerprint !== fingerprint)
      throw new ConflictException(
        ErrorCode.IDEMPOTENCY_MISMATCH,
        'Handoff request ID was reused with different content',
      );
    if (existing.expiresAt.getTime() <= Date.now()) throw this.expired();
    return this.toPrepared(existing, this.preview(existing));
  }
  private preview(handoff: ConversationPlaybookHandoffRecord): ConversationPlaybookPreviewV1 {
    const context = handoff.context;
    return {
      goal: context.userGoal,
      answerOutline: context.answerOutline,
      executionSummaries: context.executionSummaries,
      planSteps: context.planSteps,
      actions: context.actions,
      resources: [...context.agents, ...context.skills, ...context.references],
      omissions: context.projection.omissions,
    };
  }
  private toPrepared(
    handoff: ConversationPlaybookHandoffRecord,
    preview: ConversationPlaybookPreviewV1,
  ) {
    return {
      contractVersion: 1 as const,
      status: 'prepared' as const,
      handoffId: handoff.handoffId,
      platformConversationId: handoff.platformConversationId,
      suggestedPrompt: SUGGESTED_PROMPT,
      expiresAt: handoff.expiresAt.toISOString(),
      preview,
      provenance: {
        sourceConversationId: handoff.sourceConversationId,
        targetMessageId: handoff.targetMessageId,
        displayedAnswerVersion: handoff.displayedAnswerVersion,
        canonicalPathFingerprint: handoff.canonicalPathFingerprint,
        contextFingerprint: handoff.contextFingerprint,
      },
    };
  }
  private hash(value: unknown): string {
    return createHash('sha256')
      .update(typeof value === 'string' ? value : JSON.stringify(value))
      .digest('hex');
  }
  private expired(): AppException {
    return new AppException({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Playbook handoff expired',
      statusCode: HttpStatus.GONE,
    });
  }
}
