import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException, BadRequestException, ConflictException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { ConversationService } from './conversation.service';
import { ConversationBranchService } from './conversation-branch.service';
import { ConversationPlaybookContextProjectorService } from './conversation-playbook-context-projector.service';
import { ConversationPlaybookHandoff, ConversationPlaybookHandoffDocument } from '../schemas/conversation-playbook-handoff.schema';
import type { PreparePlaybookHandoffDto } from '../dto/prepare-playbook-handoff.dto';
import type { ConversationPlaybookPreviewV1, ResolvedConversationPlaybookHandoffV1 } from '../interfaces/conversation-playbook-handoff.interface';

const HANDOFF_RETENTION_MS = 24 * 60 * 60 * 1000;
const SUGGESTED_PROMPT = `Create a reusable Yellowmind Playbook that achieves the business goal from this conversation.

Define one workflow node per meaningful business capability, decision, review, or outcome—not per technical tool or API call. Group related tool calls that support the same business step. Treat connectors, tools, agents, and raw action names as implementation details within the appropriate business node.

Generalize organization names, dates, reporting periods, and other one-off values into inputs. Preserve business rules, required resources, approvals, validation, and expected outputs. Ask for clarification when a required binding or business decision is ambiguous.

Do not copy the answer as a fixed result; create the reusable process that can produce an equivalent outcome for new inputs.`;

@Injectable()
export class ConversationPlaybookHandoffService {
  constructor(
    @InjectModel(ConversationPlaybookHandoff.name)
    private readonly handoffModel: Model<ConversationPlaybookHandoffDocument>,
    private readonly branchService: ConversationBranchService,
    private readonly projector: ConversationPlaybookContextProjectorService,
    private readonly conversationService: ConversationService,
  ) { }

  async prepare(sourceConversationId: string, ownerId: string, dto: PreparePlaybookHandoffDto): Promise<{
    contractVersion: 1; status: 'prepared'; handoffId: string; platformConversationId: string;
    suggestedPrompt: string; expiresAt: string; preview: ConversationPlaybookPreviewV1;
    provenance: { sourceConversationId: string; targetMessageId: string; displayedAnswerVersion: string; canonicalPathFingerprint: string; contextFingerprint: string };
  }> {
    const requestFingerprint = this.hash({
      contractVersion: dto.contractVersion,
      sourceConversationId,
      targetMessageId: dto.targetMessageId,
      displayedAnswerVersion: dto.displayedAnswerVersion,
      activeBranches: Object.entries(dto.activeBranches).sort(([left], [right]) => left.localeCompare(right)),
      branchSelectionFingerprint: dto.branchSelectionFingerprint,
    });
    const existing = await this.handoffModel.findOne({ ownerId: new Types.ObjectId(ownerId), creationRequestId: dto.creationRequestId }).lean().exec();
    if (existing) return this.replayPrepared(existing, requestFingerprint);

    const expectedBranchFingerprint = this.hash({
      contractVersion: 1,
      targetMessageId: dto.targetMessageId,
      displayedAnswerVersion: dto.displayedAnswerVersion,
      activeBranches: Object.entries(dto.activeBranches).sort(([left], [right]) => left.localeCompare(right)),
    });
    if (expectedBranchFingerprint !== dto.branchSelectionFingerprint) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Branch selection fingerprint does not match the request');
    }
    const canonical = await this.branchService.resolveCanonicalPath(sourceConversationId, ownerId, dto.targetMessageId, dto.activeBranches);
    const target = canonical.messages.find((message) => message._id.toString() === dto.targetMessageId);
    if (!target) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    const answer = this.projector.resolveDisplayedAnswer(target, dto.displayedAnswerVersion);
    const projected = this.projector.project(canonical.path.map((message) => message._id.toString() === dto.targetMessageId
      ? { ...message, components: answer.components }
      : message), answer);
    const contextFingerprint = this.hash(projected.context);
    const handoffId = randomUUID();
    const platformConversation = await this.conversationService.create(ownerId, {
      runtimePurpose: 'platform_copilot',
      creationRequestId: `playbook-handoff:${dto.creationRequestId}`,
    });
    const expiresAt = new Date(Date.now() + HANDOFF_RETENTION_MS);
    const sourceWorkspaceIds = (canonical.source.workspaces ?? []).map((id: Types.ObjectId) => id.toString());
    try {
      const created = await this.handoffModel.create({
        contractVersion: 1,
        handoffId,
        ownerId: new Types.ObjectId(ownerId),
        sourceConversationId: new Types.ObjectId(sourceConversationId),
        targetMessageId: new Types.ObjectId(dto.targetMessageId),
        displayedAnswerVersion: dto.displayedAnswerVersion,
        creationRequestId: dto.creationRequestId,
        creationRequestFingerprint: requestFingerprint,
        clientBranchSelectionFingerprint: dto.branchSelectionFingerprint,
        canonicalPathFingerprint: canonical.fingerprint,
        contextFingerprint,
        canonicalSelectedAnswerIds: canonical.selectedAnswerIds.map((id) => new Types.ObjectId(id)),
        platformConversationId: new Types.ObjectId(platformConversation.id),
        context: projected.context,
        candidateBindings: { workspaceIds: sourceWorkspaceIds, documentIds: [], connectorIds: [], agentIds: [], skillIds: [] },
        defaultWorkspaceIds: sourceWorkspaceIds.length === 1 ? sourceWorkspaceIds : [],
        status: 'prepared',
        preparedAt: new Date(),
        expiresAt,
      });
      return this.toPrepared(created.toObject(), projected.preview);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const raced = await this.handoffModel.findOne({ ownerId: new Types.ObjectId(ownerId), creationRequestId: dto.creationRequestId }).lean().exec();
      if (!raced) throw error;
      return this.replayPrepared(raced, requestFingerprint);
    }
  }

  async bind(input: { handoffId: string; ownerId: string; platformConversationId: string; turnRequestId: string; prompt: string }): Promise<void> {
    const promptHash = this.hash(input.prompt.trim());
    const now = new Date();
    const bound = await this.handoffModel.findOneAndUpdate({
      handoffId: input.handoffId,
      ownerId: new Types.ObjectId(input.ownerId),
      platformConversationId: new Types.ObjectId(input.platformConversationId),
      status: 'prepared',
      expiresAt: { $gt: now },
    }, { $set: { status: 'bound', boundTurnRequestId: input.turnRequestId, boundPromptHash: promptHash, boundAt: now } }, { new: true }).lean().exec();
    if (bound) return;
    const existing = await this.handoffModel.findOne({ handoffId: input.handoffId, ownerId: new Types.ObjectId(input.ownerId) }).lean().exec();
    if (!existing || existing.platformConversationId.toString() !== input.platformConversationId) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Playbook handoff not found');
    }
    if (existing.expiresAt.getTime() <= Date.now()) throw this.expired();
    if (existing.boundTurnRequestId === input.turnRequestId && existing.boundPromptHash === promptHash) return;
    throw new ConflictException(ErrorCode.IDEMPOTENCY_MISMATCH, 'Playbook handoff is already bound to another turn');
  }

  async attachUserMessage(handoffId: string, ownerId: string, userMessageId: string): Promise<void> {
    await this.handoffModel.updateOne({ handoffId, ownerId: new Types.ObjectId(ownerId), status: 'bound' }, {
      $set: { boundUserMessageId: new Types.ObjectId(userMessageId) },
    }).exec();
  }

  async consume(input: { handoffId: string; ownerId: string; platformConversationId: string; turnRequestId: string; userMessageId: string }): Promise<ResolvedConversationPlaybookHandoffV1> {
    const handoff = await this.handoffModel.findOne({
      handoffId: input.handoffId,
      ownerId: new Types.ObjectId(input.ownerId),
      platformConversationId: new Types.ObjectId(input.platformConversationId),
      boundTurnRequestId: input.turnRequestId,
      boundUserMessageId: new Types.ObjectId(input.userMessageId),
      status: { $in: ['bound', 'consumed'] },
    }).lean().exec();
    if (!handoff) throw new ConflictException(ErrorCode.CONFLICT, 'Playbook handoff turn binding does not match');
    if (handoff.status === 'bound') {
      await this.handoffModel.updateOne({ _id: handoff._id, status: 'bound' }, { $set: { status: 'consumed', consumedAt: new Date() } }).exec();
    }
    return {
      handoffId: handoff.handoffId,
      handoffVersion: 1,
      sourceConversationId: handoff.sourceConversationId.toString(),
      targetMessageId: handoff.targetMessageId.toString(),
      displayedAnswerVersion: handoff.displayedAnswerVersion,
      canonicalPathFingerprint: handoff.canonicalPathFingerprint,
      contextFingerprint: handoff.contextFingerprint,
      context: handoff.context,
      workspaceDefaultIds: handoff.defaultWorkspaceIds,
      acceptedAt: (handoff.consumedAt ?? new Date()).toISOString(),
    };
  }

  private replayPrepared(existing: ConversationPlaybookHandoff, fingerprint: string) {
    if (existing.creationRequestFingerprint !== fingerprint) throw new ConflictException(ErrorCode.IDEMPOTENCY_MISMATCH, 'Handoff request ID was reused with different content');
    if (existing.expiresAt.getTime() <= Date.now()) throw this.expired();
    return this.toPrepared(existing, this.preview(existing));
  }
  private preview(handoff: ConversationPlaybookHandoff): ConversationPlaybookPreviewV1 {
    const context = handoff.context;
    return { goal: context.userGoal, answerOutline: context.answerOutline, executionSummaries: context.executionSummaries, planSteps: context.planSteps, actions: context.actions, resources: [...context.agents, ...context.skills, ...context.references], omissions: context.projection.omissions };
  }
  private toPrepared(handoff: ConversationPlaybookHandoff, preview: ConversationPlaybookPreviewV1) {
    return {
      contractVersion: 1 as const, status: 'prepared' as const, handoffId: handoff.handoffId,
      platformConversationId: handoff.platformConversationId.toString(), suggestedPrompt: SUGGESTED_PROMPT,
      expiresAt: handoff.expiresAt.toISOString(), preview,
      provenance: { sourceConversationId: handoff.sourceConversationId.toString(), targetMessageId: handoff.targetMessageId.toString(), displayedAnswerVersion: handoff.displayedAnswerVersion, canonicalPathFingerprint: handoff.canonicalPathFingerprint, contextFingerprint: handoff.contextFingerprint },
    };
  }
  private hash(value: unknown): string { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
  private expired(): AppException {
    return new AppException({ code: ErrorCode.SERVICE_UNAVAILABLE, message: 'Playbook handoff expired', statusCode: HttpStatus.GONE });
  }
}
